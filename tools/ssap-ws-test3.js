// SSAP 亮度实测 v3:逐个键读取 + 写 backlight
// 用法: node ssap-ws-test3.js <clientKey> [TARGET]
const WebSocket = require('ws');
const TV_IP = '192.168.1.4';
const SRC_IP = '192.168.1.5';
const clientKey = process.argv[2] || null;

let msgId = 0;
const nextId = () => String(++msgId);

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

    // hello
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('hello timeout')), 6000);
        helloWaiters.push(() => { clearTimeout(timer); resolve(); });
        ws.send(JSON.stringify({ id: 'hello', type: 'hello', payload: {} }));
    });

    // 注册前 getSystemInfo
    await request('ssap://system/getSystemInfo', {});

    // register
    const regMsg = await new Promise((resolve) => {
        regWaiters.push(resolve);
        ws.send(JSON.stringify({ id: 'register', type: 'register', payload: buildRegisterPayload(clientKey) }));
    });
    const newKey = regMsg.payload && (regMsg.payload['client-key'] || regMsg.payload.clientKey);
    console.log('[client-key] => ' + newKey);
    console.log('');

    // 逐个键读取
    const keys = ['backlight', 'oledLight', 'brightness', 'energySaving', 'pictureMode'];
    for (const k of keys) {
        const r = await request('ssap://settings/getSystemSettings', { category: 'picture', keys: [k] });
        const ok = r.type === 'response' && r.payload && r.payload.returnValue === true;
        const val = ok ? JSON.stringify(r.payload.settings) : (r.payload ? r.payload.errorText : r.error);
        console.log(`[read] ${k}: ${ok ? 'OK ' + val : 'FAIL ' + val}`);
    }
    console.log('');

    // createAlert 写 backlight
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

    // 读回验证(只读 backlight)
    const verifyResp = await request('ssap://settings/getSystemSettings', { category: 'picture', keys: ['backlight'] });
    console.log('[verify backlight] =>', JSON.stringify(verifyResp, null, 2));

    process.exit(0);
}

main().catch((e) => { console.error('[fail]', e.message); process.exit(1); });
