// SSAP 亮度实测 v5:步进测试(+1 / -1)
// 流程:读当前 -> 写 +1 -> 读回 -> 写 -1 -> 读回(回到原值)
// 用法: node ssap-ws-test5.js <clientKey>
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

    async function readBacklight() {
        const r = await request('ssap://settings/getSystemSettings', { category: 'picture', keys: ['backlight'] });
        return r.payload && r.payload.settings ? r.payload.settings.backlight : null;
    }

    async function setBacklight(val) {
        const lunaUri = 'luna://com.webos.settingsservice/setSystemSettings';
        const params = { category: 'picture', settings: { backlight: String(val) } };
        const alertPayload = {
            message: ' ',
            buttons: [{ label: '', onClick: lunaUri, params }],
            onclose: { uri: lunaUri, params },
            onfail: { uri: lunaUri, params }
        };
        const c = await request('ssap://system.notifications/createAlert', alertPayload);
        const aid = c.payload && c.payload.alertId;
        if (aid) await request('ssap://system.notifications/closeAlert', { alertId: aid });
        await new Promise((r) => setTimeout(r, 1200));
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

    // 步进测试
    const cur = parseInt(await readBacklight(), 10);
    console.log('[0] 当前 backlight = ' + cur);

    // +1
    const up = Math.min(cur + 1, 100);
    await setBacklight(up);
    const upRead = parseInt(await readBacklight(), 10);
    console.log('[+1] 目标=' + up + ' 读回=' + upRead + ' => ' + (upRead === up ? '✅' : '❌'));

    // -1 (回到 cur)
    const down = Math.max(cur, 0);
    await setBacklight(down);
    const downRead = parseInt(await readBacklight(), 10);
    console.log('[-1] 目标=' + down + ' 读回=' + downRead + ' => ' + (downRead === down ? '✅' : '❌'));

    console.log('');
    console.log('== 步进 +1/-1 实测完成 ==');
    process.exit(0);
}

main().catch((e) => { console.error('[fail]', e.message); process.exit(1); });
