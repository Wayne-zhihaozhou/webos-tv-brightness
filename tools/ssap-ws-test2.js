// SSAP 亮度实测 v2:复刻 aiowebostv 握手(无签名,先 hello 再 getSystemInfo 再 register)
// 用法: node ssap-ws-test2.js [clientKey]
const WebSocket = require('ws');
const TV_IP = '192.168.1.4';
const SRC_IP = '192.168.1.5';
const clientKey = process.argv[2] || null;

let msgId = 0;
const nextId = () => String(++msgId);

// aiowebostv 的注册 payload(无签名)
function buildRegisterPayload(ck) {
    const payload = {
        forcePairing: false,
        pairingType: 'PROMPT',
        manifest: {
            appVersion: '1.1',
            manifestVersion: 1,
            permissions: [
                'APP_TO_APP', 'CLOSE', 'CONTROL_AUDIO', 'CONTROL_DISPLAY',
                'CONTROL_INPUT_JOYSTICK', 'CONTROL_INPUT_MEDIA_PLAYBACK',
                'CONTROL_INPUT_MEDIA_RECORDING', 'CONTROL_INPUT_TEXT',
                'CONTROL_INPUT_TV', 'CONTROL_MOUSE_AND_KEYBOARD', 'CONTROL_POWER',
                'CONTROL_TV_SCREEN', 'LAUNCH', 'LAUNCH_WEBAPP', 'READ_APP_STATUS',
                'READ_COUNTRY_INFO', 'READ_CURRENT_CHANNEL', 'READ_INPUT_DEVICE_LIST',
                'READ_INSTALLED_APPS', 'READ_LGE_SDX', 'READ_LGE_TV_INPUT_EVENTS',
                'READ_NETWORK_STATE', 'READ_NOTIFICATIONS', 'READ_POWER_STATE',
                'READ_RUNNING_APPS', 'READ_SETTINGS', 'READ_TV_CHANNEL_LIST',
                'READ_TV_CURRENT_TIME', 'READ_UPDATE_INFO', 'SEARCH', 'TEST_OPEN',
                'TEST_PROTECTED', 'TEST_SECURE', 'UPDATE_FROM_REMOTE_APP',
                'WRITE_NOTIFICATION_ALERT', 'WRITE_NOTIFICATION_TOAST', 'WRITE_SETTINGS',
            ],
        },
    };
    if (ck) payload['client-key'] = ck;
    return payload;
}

async function connectWS() {
    // 先 ws://3000,失败回退 wss://3001 (aiowebostv 逻辑)
    const attempts = [
        { url: `ws://${TV_IP}:3000`, opts: { localAddress: SRC_IP } },
        { url: `wss://${TV_IP}:3001`, opts: { localAddress: SRC_IP, rejectUnauthorized: false } },
    ];
    let lastErr = null;
    for (const a of attempts) {
        try {
            const ws = new WebSocket(a.url, a.opts);
            await new Promise((resolve, reject) => {
                ws.on('open', resolve);
                ws.on('error', reject);
            });
            console.log('[ok] connected ' + a.url + ' (src ' + SRC_IP + ')');
            return ws;
        } catch (e) {
            lastErr = e;
            console.log('[!] ' + a.url + ' failed: ' + e.message);
        }
    }
    throw new Error('all connect attempts failed: ' + (lastErr && lastErr.message));
}

async function main() {
    const ws = await connectWS();
    const pending = new Map();
    const regWaiters = [];
    const helloWaiters = [];

    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        console.log('[recv]', JSON.stringify(msg).slice(0, 300));
        if (msg.type === 'registered') {
            regWaiters.forEach((r) => r(msg));
            regWaiters.length = 0;
            return;
        }
        if (msg.type === 'hello') {
            helloWaiters.forEach((r) => r(msg));
            helloWaiters.length = 0;
            return;
        }
        if (msg.type === 'response' || msg.type === 'error') {
            const cont = pending.get(msg.id);
            if (cont) { pending.delete(msg.id); cont(msg); }
        }
    });
    ws.on('close', () => { console.log('[!] ws closed'); process.exit(1); });
    ws.on('error', (e) => { console.log('[!] ws error:', e.message); });

    function request(uri, payload = {}, timeoutMs = 6000) {
        return new Promise((resolve, reject) => {
            const id = nextId();
            const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout: ' + uri)); }, timeoutMs);
            pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
            ws.send(JSON.stringify({ id, type: 'request', uri, payload }));
        });
    }

    // 1. hello
    const helloMsg = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('hello timeout')), 6000);
        helloWaiters.push((msg) => { clearTimeout(timer); resolve(msg); });
        ws.send(JSON.stringify({ id: 'hello', type: 'hello', payload: {} }));
    });
    console.log('[hello] =>', JSON.stringify(helloMsg.payload));
    console.log('');

    // 2. 注册前 getSystemInfo(新固件要求)
    const sysinfo = await request('ssap://system/getSystemInfo', {});
    console.log('[pre-reg getSystemInfo] =>', JSON.stringify(sysinfo).slice(0, 400));
    console.log('');

    // 3. register(无签名)
    const regMsg = await new Promise((resolve) => {
        regWaiters.push(resolve);
        ws.send(JSON.stringify({ id: 'register', type: 'register', payload: buildRegisterPayload(clientKey) }));
    });
    console.log('[register] =>', JSON.stringify(regMsg).slice(0, 400));
    const newKey = regMsg.payload && (regMsg.payload['client-key'] || regMsg.payload.clientKey);
    if (newKey) console.log('[client-key] => ' + newKey);
    console.log('');

    // 4. 读当前亮度
    const readResp = await request('ssap://settings/getSystemSettings', { category: 'picture', keys: ['backlight', 'oledLight', 'brightness', 'energySaving'] });
    console.log('[read picture] =>', JSON.stringify(readResp, null, 2));
    console.log('');

    // 5. createAlert 写亮度
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
    const alertId = createResp.payload && createResp.payload.alertId;
    if (alertId) {
        const closeResp = await request('ssap://system.notifications/closeAlert', { alertId });
        console.log('[closeAlert] =>', JSON.stringify(closeResp));
    } else {
        console.log('[!] no alertId returned');
    }
    console.log('');

    // 6. 读回验证
    const verifyResp = await request('ssap://settings/getSystemSettings', { category: 'picture', keys: ['backlight', 'oledLight', 'brightness', 'energySaving'] });
    console.log('[verify picture] =>', JSON.stringify(verifyResp, null, 2));

    process.exit(0);
}

main().catch((e) => { console.error('[fail]', e.message); process.exit(1); });
