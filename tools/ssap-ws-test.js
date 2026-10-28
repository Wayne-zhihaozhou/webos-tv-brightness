// SSAP 亮度实测(ws 库 + localAddress 绑定源地址)
// 用法: node ssap-ws-test.js [clientKey]
const WebSocket = require('ws');
const TV_IP = '192.168.1.4';
const SRC_IP = '192.168.1.5';
const clientKey = process.argv[2] || null;

let msgId = 0;
const nextId = () => String(++msgId);

async function main() {
    const ws = new WebSocket(`wss://${TV_IP}:3001`, {
        rejectUnauthorized: false,
        localAddress: SRC_IP,
        handshakeTimeout: 8000
    });

    const pending = new Map();
    const regWaiters = [];

    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        console.log('[recv]', JSON.stringify(msg).slice(0, 300));
        if (msg.type === 'registered') {
            regWaiters.forEach((r) => r(msg));
            regWaiters.length = 0;
            return;
        }
        if (msg.type === 'response' || msg.type === 'error') {
            const cont = pending.get(msg.id);
            if (cont) { pending.delete(msg.id); cont(msg); }
        }
    });
    ws.on('close', () => { console.log('[!] ws closed'); process.exit(1); });
    ws.on('error', (e) => { console.log('[!] ws error:', e.message); });

    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
    });
    console.log('[ok] connected wss://' + TV_IP + ':3001 from ' + SRC_IP);

    function request(uri, payload = {}, timeoutMs = 6000) {
        return new Promise((resolve, reject) => {
            const id = nextId();
            const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout: ' + uri)); }, timeoutMs);
            pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
            ws.send(JSON.stringify({ id, type: 'request', uri, payload }));
        });
    }

    // 注册
    const registerPayload = {
        forcePairing: false,
        pairingType: 'PROMPT',
        manifest: {
            manifestVersion: 1,
            appVersion: '1.1',
            signed: {
                created: '20140509',
                appId: 'com.lge.test',
                vendorId: 'com.lge',
                localizedAppNames: { '': 'LG Remote App', 'ko-KR': '리모컨 앱', 'zxx-XX': 'ЛГ Rэmotэ AПП' },
                localizedVendorNames: { '': 'LG Electronics' },
                permissions: [
                    'TEST_SECURE', 'CONTROL_INPUT_TEXT', 'CONTROL_MOUSE_AND_KEYBOARD',
                    'READ_INSTALLED_APPS', 'READ_LGE_SDX', 'READ_NOTIFICATIONS',
                    'SEARCH', 'WRITE_SETTINGS', 'WRITE_NOTIFICATION_ALERT',
                    'CONTROL_POWER', 'READ_CURRENT_CHANNEL', 'READ_RUNNING_APPS',
                    'READ_UPDATE_INFO', 'UPDATE_FROM_REMOTE_APP', 'READ_LGE_TV_INPUT_EVENTS',
                    'READ_TV_CURRENT_TIME'
                ],
                serial: '2f930e2d2cfe083771f68e4fe7bb07'
            },
            permissions: [
                'LAUNCH', 'LAUNCH_WEBAPP', 'APP_TO_APP', 'CLOSE', 'TEST_OPEN', 'TEST_PROTECTED',
                'CONTROL_AUDIO', 'CONTROL_DISPLAY', 'CONTROL_INPUT_JOYSTICK',
                'CONTROL_INPUT_MEDIA_RECORDING', 'CONTROL_INPUT_MEDIA_PLAYBACK',
                'CONTROL_INPUT_TV', 'CONTROL_POWER', 'CONTROL_TV_SCREEN', 'READ_APP_STATUS',
                'READ_CURRENT_CHANNEL', 'READ_INPUT_DEVICE_LIST', 'READ_NETWORK_STATE',
                'READ_RUNNING_APPS', 'READ_TV_CHANNEL_LIST', 'WRITE_NOTIFICATION_TOAST',
                'READ_POWER_STATE', 'READ_COUNTRY_INFO', 'CONTROL_INPUT_TEXT',
                'CONTROL_MOUSE_AND_KEYBOARD', 'READ_INSTALLED_APPS', 'READ_SETTINGS',
                'READ_STORAGE_DEVICE_LIST'
            ],
            signatures: [{
                signature: 'eyJhbGdvcml0aG0iOiJSU0EtU0hBMjU2Iiwia2V5SWQiOiJ0ZXN0LXNpZ25pbmctY2VydCIsInNpZ25hdHVyZVZlcnNpb24iOjF9.hrVRgjCwXVvE2OOSpDZ58hR+59aFNwYDyjQgKk3auukd7pcegmE2CzPCa0bJ0ZsRAcKkCTJrWo5iDzNhMBWRyaMOv5zWSrthlf7G128qvIlpMT0YNY+n/FaOHE73uLrS/g7swl3/qH/BGFG2Hu4RlL48eb3lLKqTt2xKHdCs6Cd4RMfJPYnzgvI4BNrFUKsjkcu+WD4OO2A27Pq1n50cMchmcaXadJhGrOqH5YmHdOCj5NSHzJYrsW0HPlpuAx/ECMeIZYDh6RMqaFM2DXzdKX9NmmyqzJ3o/0lkk/N97gfVRLW5hA29yeAwaCViZNCP8iC9aO0q9fQojoa7NQnAtw==',
                signatureVersion: 1
            }]
        }
    };
    if (clientKey) registerPayload['client-key'] = clientKey;

    const regMsg = await new Promise((resolve) => {
        regWaiters.push(resolve);
        ws.send(JSON.stringify({ id: 'register', type: 'register', payload: registerPayload }));
    });
    console.log('[register] =>', JSON.stringify(regMsg).slice(0, 400));
    const newKey = regMsg.payload && (regMsg.payload['client-key'] || regMsg.payload.clientKey);
    if (newKey) console.log('[client-key] => ' + newKey);
    console.log('');

    // 读当前亮度
    const readResp = await request('ssap://settings/getSystemSettings', { category: 'picture', keys: ['backlight', 'oledLight', 'brightness', 'energySaving'] });
    console.log('[read picture] =>', JSON.stringify(readResp, null, 2));
    console.log('');

    // createAlert 写亮度
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

    // 读回验证
    const verifyResp = await request('ssap://settings/getSystemSettings', { category: 'picture', keys: ['backlight', 'oledLight', 'brightness', 'energySaving'] });
    console.log('[verify picture] =>', JSON.stringify(verifyResp, null, 2));

    process.exit(0);
}

main().catch((e) => { console.error('[fail]', e.message); process.exit(1); });
