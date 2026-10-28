// SSAP 亮度实测脚本:绑定源地址连接 webOS TV,配对 + 读亮度 + createAlert 写亮度 + 读回验证
// 用法: node ssap-brightness-test.js <tv-ip> <client-key 可选>

const TV_IP = process.argv[2] || '192.168.1.4';
const SRC_IP = '192.168.1.5'; // 本地物理网卡,绕过 VPN 劫持
const PORT = 3001; // wss(新固件); 失败可试 3000 ws

const { connect } = require('net');
const tls = require('tls');

// ---- 简易 WSS 客户端:绑定源地址 ----
class BoundWebSocket {
    constructor(url, srcIp) {
        this.url = new URL(url);
        this.srcIp = srcIp;
    }
    connect() {
        return new Promise((resolve, reject) => {
            const isWss = this.url.protocol === 'wss:';
            const port = parseInt(this.url.port);
            const socket = isWss
                ? tls.connect({ host: this.url.hostname, port, rejectUnauthorized: false, localAddress: this.srcIp })
                : connect({ host: this.url.hostname, port, localAddress: this.srcIp });
            socket.setTimeout(8000);
            socket.once('secureConnect', () => this._handshake(socket, resolve, reject));
            socket.once('connect', () => this._handshake(socket, resolve, reject));
            socket.once('timeout', () => reject(new Error('connect timeout')));
            socket.once('error', (e) => reject(e));
        });
    }
    _handshake(socket, resolve, reject) {
        const key = require('crypto').randomBytes(16).toString('base64');
        const req = `GET / HTTP/1.1\r\nHost: ${this.url.hostname}:${this.url.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`;
        let buf = Buffer.alloc(0);
        const onData = (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            const idx = buf.indexOf('\r\n\r\n');
            if (idx >= 0) {
                const header = buf.slice(0, idx).toString();
                if (header.includes('101')) {
                    socket.removeListener('data', onData);
                    this.socket = socket;
                    this._leftover = buf.slice(idx + 4);
                    resolve(this);
                } else {
                    socket.removeListener('data', onData);
                    reject(new Error('handshake failed: ' + header.split('\r\n')[0]));
                }
            }
        };
        socket.on('data', onData);
        socket.write(req);
    }
    send(obj) {
        const data = Buffer.from(JSON.stringify(obj));
        const len = data.length;
        let header;
        if (len < 126) {
            header = Buffer.from([0x81, 0x80 | len]);
        } else if (len < 65536) {
            header = Buffer.alloc(4);
            header[0] = 0x81; header[1] = 0x80 | 126;
            header.writeUInt16BE(len, 2);
        } else {
            header = Buffer.alloc(10);
            header[0] = 0x81; header[1] = 0x80 | 127;
            header.writeBigUInt64BE(BigInt(len), 2);
        }
        const mask = require('crypto').randomBytes(4);
        const masked = Buffer.alloc(len);
        for (let i = 0; i < len; i++) masked[i] = data[i] ^ mask[i % 4];
        this.socket.write(Buffer.concat([header, mask, masked]));
    }
    onMessage(cb) {
        this.socket.on('data', (chunk) => {
            let buf = this._leftover ? Buffer.concat([this._leftover, chunk]) : chunk;
            this._leftover = null;
            while (buf.length > 0) {
                if (buf.length < 2) { this._leftover = buf; break; }
                const opcode = buf[0] & 0x0f;
                const masked = (buf[1] & 0x80) !== 0;
                let len = buf[1] & 0x7f;
                let offset = 2;
                if (len === 126) {
                    if (buf.length < 4) { this._leftover = buf; break; }
                    len = buf.readUInt16BE(2); offset = 4;
                } else if (len === 127) {
                    if (buf.length < 10) { this._leftover = buf; break; }
                    len = Number(buf.readBigUInt64BE(2)); offset = 10;
                }
                const maskKey = masked ? buf.slice(offset, offset + 4) : null;
                offset += masked ? 4 : 0;
                if (buf.length < offset + len) { this._leftover = buf; break; }
                let payload = buf.slice(offset, offset + len);
                if (maskKey) {
                    const unmasked = Buffer.alloc(len);
                    for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ maskKey[i % 4];
                    payload = unmasked;
                }
                buf = buf.slice(offset + len);
                if (opcode === 1) {
                    try { cb(JSON.parse(payload.toString())); } catch (e) { cb({ raw: payload.toString() }); }
                } else if (opcode === 8) {
                    cb({ closed: true });
                }
            }
        });
    }
}

// ---- 主流程 ----
let msgId = 0;
function nextId() { return ++msgId; }

async function main() {
    const clientKey = process.argv[3] || null;
    const ws = await new BoundWebSocket(`wss://${TV_IP}:${PORT}`, SRC_IP).connect();
    console.log('[ok] connected to wss://' + TV_IP + ':' + PORT + ' (src ' + SRC_IP + ')');

    const pending = new Map();
    ws.onMessage((msg) => {
        console.log('[recv]', JSON.stringify(msg));
        if (msg.closed) { console.log('[!] socket closed by TV'); process.exit(1); }
        const type = msg.type;
        if (type === 'registered' || type === 'response' || type === 'error') {
            const cont = pending.get(msg.id);
            if (cont) { pending.delete(msg.id); cont(msg); }
            else if (type === 'registered') { pending.get('register')?.(msg); pending.delete('register'); }
        }
    });

    function request(uri, payload = {}, timeoutMs = 6000) {
        return new Promise((resolve, reject) => {
            const id = String(nextId());
            const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout: ' + uri)); }, timeoutMs);
            pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
            ws.send({ id, type: 'request', uri, payload });
        });
    }

    // 1. 注册配对
    const registerPayload = {
        "forcePairing": false,
        "pairingType": "PROMPT",
        "manifest": {
            "manifestVersion": 1,
            "appVersion": "1.1",
            "signed": {
                "created": "20140509",
                "appId": "com.lge.test",
                "vendorId": "com.lge",
                "localizedAppNames": { "": "LG Remote App", "ko-KR": "리모컨 앱", "zxx-XX": "ЛГ Rэмotэ AПП" },
                "localizedVendorNames": { "": "LG Electronics" },
                "permissions": [
                    "TEST_SECURE", "CONTROL_INPUT_TEXT", "CONTROL_MOUSE_AND_KEYBOARD",
                    "READ_INSTALLED_APPS", "READ_LGE_SDX", "READ_NOTIFICATIONS",
                    "SEARCH", "WRITE_SETTINGS", "WRITE_NOTIFICATION_ALERT",
                    "CONTROL_POWER", "READ_CURRENT_CHANNEL", "READ_RUNNING_APPS",
                    "READ_UPDATE_INFO", "UPDATE_FROM_REMOTE_APP", "READ_LGE_TV_INPUT_EVENTS",
                    "READ_TV_CURRENT_TIME"
                ],
                "serial": "2f930e2d2cfe083771f68e4fe7bb07"
            },
            "permissions": [
                "LAUNCH", "LAUNCH_WEBAPP", "APP_TO_APP", "CLOSE", "TEST_OPEN", "TEST_PROTECTED",
                "CONTROL_AUDIO", "CONTROL_DISPLAY", "CONTROL_INPUT_JOYSTICK",
                "CONTROL_INPUT_MEDIA_RECORDING", "CONTROL_INPUT_MEDIA_PLAYBACK",
                "CONTROL_INPUT_TV", "CONTROL_POWER", "CONTROL_TV_SCREEN", "READ_APP_STATUS",
                "READ_CURRENT_CHANNEL", "READ_INPUT_DEVICE_LIST", "READ_NETWORK_STATE",
                "READ_RUNNING_APPS", "READ_TV_CHANNEL_LIST", "WRITE_NOTIFICATION_TOAST",
                "READ_POWER_STATE", "READ_COUNTRY_INFO", "CONTROL_INPUT_TEXT",
                "CONTROL_MOUSE_AND_KEYBOARD", "READ_INSTALLED_APPS", "READ_SETTINGS",
                "READ_STORAGE_DEVICE_LIST"
            ],
            "signatures": [{
                "signature": "eyJhbGdvcml0aG0iOiJSU0EtU0hBMjU2Iiwia2V5SWQiOiJ0ZXN0LXNpZ25pbmctY2VydCIsInNpZ25hdHVyZVZlcnNpb24iOjF9.hrVRgjCwXVvE2OOSpDZ58hR+59aFNwYDyjQgKk3auukd7pcegmE2CzPCa0bJ0ZsRAcKkCTJrWo5iDzNhMBWRyaMOv5zWSrthlf7G128qvIlpMT0YNY+n/FaOHE73uLrS/g7swl3/qH/BGFG2Hu4RlL48eb3lLKqTt2xKHdCs6Cd4RMfJPYnzgvI4BNrFUKsjkcu+WD4OO2A27Pq1n50cMchmcaXadJhGrOqH5YmHdOCj5NSHzJYrsW0HPlpuAx/ECMeIZYDh6RMqaFM2DXzdKX9NmmyqzJ3o/0lkk/N97gfVRLW5hA29yeAwaCViZNCP8iC9aO0q9fQojoa7NQnAtw==",
                "signatureVersion": 1
            }]
        }
    };
    if (clientKey) registerPayload["client-key"] = clientKey;

    const regPromise = new Promise((resolve) => pending.set('register', resolve));
    ws.send({ id: 'register', type: 'register', payload: registerPayload });
    const regResp = await regPromise;
    console.log('[register] =>', JSON.stringify(regResp));

    if (regResp.type === 'error') {
        console.log('[!] register error: ' + regResp.error);
        process.exit(1);
    }
    const newKey = regResp.payload && (regResp.payload['client-key'] || regResp.payload.clientKey);
    if (newKey) console.log('[client-key] => ' + newKey);
    console.log(''); // 分隔

    // 2. 读当前亮度(直接 SSAP)
    const readResp = await request('ssap://settings/getSystemSettings', { category: 'picture', keys: ['backlight', 'oledLight', 'brightness', 'energySaving'] });
    console.log('[read picture] =>', JSON.stringify(readResp, null, 2));
    console.log('');

    // 3. createAlert 写亮度(以环境变量 TARGET 指定目标值,默认 60)
    const target = process.env.TARGET || '60';
    const lunaUri = 'luna://com.webos.settingsservice/setSystemSettings';
    const params = { category: 'picture', settings: { backlight: target } };
    const alertPayload = {
        message: ' ',
        buttons: [{ label: '', onClick: lunaUri, params }],
        onclose: { uri: lunaUri, params },
        onfail: { uri: lunaUri, params }
    };
    const createResp = await request('ssap://system.notifications/createAlert', alertPayload);
    console.log('[createAlert] =>', JSON.stringify(createResp));

    let alertId = createResp.payload && createResp.payload.alertId;
    if (alertId) {
        const closeResp = await request('ssap://system.notifications/closeAlert', { alertId });
        console.log('[closeAlert] =>', JSON.stringify(closeResp));
    } else {
        console.log('[!] no alertId returned');
    }
    console.log('');

    // 4. 读回验证
    const verifyResp = await request('ssap://settings/getSystemSettings', { category: 'picture', keys: ['backlight', 'oledLight', 'brightness', 'energySaving'] });
    console.log('[verify picture] =>', JSON.stringify(verifyResp, null, 2));

    process.exit(0);
}

main().catch((e) => { console.error('[fail]', e.message); process.exit(1); });
