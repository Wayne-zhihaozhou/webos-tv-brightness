// SSAP 亮度实测 v4:真正改变亮度并恢复
// 流程:读当前 backlight -> 写 45 -> 读回验证 -> 写回原值 -> 读回
// 用法: node ssap-ws-test4.js <clientKey>
const WebSocket = require('ws');
const TV_IP = '192.168.1.4';
const SRC_IP = '192.168.1.5';
const clientKey = process.argv[2] || null;
const NEW_VAL = '45';

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
            console.log('[ok] connected ' + a.url);
            return ws;
        } catch (e) {
            lastErr = e;
        }
    }
    throw new Error('connect failed: ' + (lastErr && lastErr.message));
}

async function main() {
    const ws = await connectWS();
    const pending = new Map();
    const regWaiters = [];
    const helloWaiters = [];

    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'registered') {
            regWaiters.forEach((r) => r(msg)); regWaiters.length = 0; return;
        }
        if (msg.type === 'hello') {
            helloWaiters.forEach((r) => r(msg)); helloWaiters.length = 0; return;
        }
        if (msg.type === 'response' || msg.type === 'error') {
            const cont = pending.get(msg.id);
            if (cont) { pending.delete(msg.id); cont(msg); }
        }
    });
    ws.on('close', () => { console.log('[!] ws closed'); process.exit(1); });

    function request(uri, payload = {}, timeoutMs = 6000) {
        return new Promise((resolve, reject) => {
            const id = nextId();
            const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout: ' + uri)); }, timeoutMs);
            pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
            ws.send(JSON.stringify({ id, type: 'request', uri, payload }));
        });
    }

    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('hello timeout')), 6000);
        helloWaiters.push(() => { clearTimeout(timer); resolve(); });
        ws.send(JSON.stringify({ id: 'hello', type: 'hello', payload: {} }));
    });
    await request('ssap://system/getSystemInfo', {});
    const regMsg = await new Promise((resolve) => {
        regWaiters.push(resolve);
        ws.send(JSON.stringify({ id: 'register', type: 'register', payload: buildRegisterPayload(clientKey) }));
    });
    console.log('[connected, client-key] => ' + (regMsg.payload && (regMsg.payload['client-key'] || regMsg.payload.clientKey)));

    // 1. 读当前
    const r0 = await request('ssap://settings/getSystemSettings', { category: 'picture', keys: ['backlight'] });
    const cur = r0.payload && r0.payload.settings ? r0.payload.settings.backlight : null;
    console.log('[1] 当前 backlight = ' + cur);

    // 2. 写 45
    const lunaUri = 'luna://com.webos.settingsservice/setSystemSettings';
    const params = { category: 'picture', settings: { backlight: NEW_VAL } };
    const alertPayload = {
        message: ' ',
        buttons: [{ label: '', onClick: lunaUri, params }],
        onclose: { uri: lunaUri, params },
        onfail: { uri: lunaUri, params }
    };
    const createResp = await request('ssap://system.notifications/createAlert', alertPayload);
    const alertId = createResp.payload && createResp.payload.alertId;
    console.log('[2] createAlert => returnValue=' + (createResp.payload && createResp.payload.returnValue) + ' alertId=' + alertId);
    if (alertId) {
        await request('ssap://system.notifications/closeAlert', { alertId });
        console.log('[2] closeAlert done');
    }
    await new Promise((r) => setTimeout(r, 1500)); // 等写入生效

    // 3. 读回验证
    const r1 = await request('ssap://settings/getSystemSettings', { category: 'picture', keys: ['backlight'] });
    const after = r1.payload && r1.payload.settings ? r1.payload.settings.backlight : null;
    console.log('[3] 写入后 backlight = ' + after + ' => ' + (after === NEW_VAL ? '✅ 写入生效' : '❌ 未生效'));

    // 4. 恢复原值
    if (cur !== null && cur !== after) {
        const params2 = { category: 'picture', settings: { backlight: cur } };
        const alertPayload2 = {
            message: ' ',
            buttons: [{ label: '', onClick: lunaUri, params: params2 }],
            onclose: { uri: lunaUri, params: params2 },
            onfail: { uri: lunaUri, params: params2 }
        };
        const c2 = await request('ssap://system.notifications/createAlert', alertPayload2);
        const aid2 = c2.payload && c2.payload.alertId;
        if (aid2) await request('ssap://system.notifications/closeAlert', { alertId: aid2 });
        await new Promise((r) => setTimeout(r, 1500));
        const r2 = await request('ssap://settings/getSystemSettings', { category: 'picture', keys: ['backlight'] });
        const restored = r2.payload && r2.payload.settings ? r2.payload.settings.backlight : null;
        console.log('[4] 恢复后 backlight = ' + restored + ' => ' + (restored === cur ? '✅ 已恢复' : '❌ 未恢复'));
    } else {
        console.log('[4] 无需恢复(原值与新值相同)');
    }

    process.exit(0);
}

main().catch((e) => { console.error('[fail]', e.message); process.exit(1); });
