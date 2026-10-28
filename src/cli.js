// 命令行入口:get / set <value> / step <+n|-n> / pair / info
// 用法:
//   node src/cli.js get
//   node src/cli.js set 60
//   node src/cli.js step +1
//   node src/cli.js step -1
//   node src/cli.js pair
//   node src/cli.js info
'use strict';

const path = require('path');
const { WebOSTVClient, loadClientKeyFor, saveClientKey } = require('./ssap-client');
const { readBacklight, setBacklight, stepBacklight, readPictureSettings } = require('./brightness');

const PROJECT_ROOT = path.resolve(__dirname, '..');

// 配置(可用环境变量覆盖)
const TV_IP = process.env.TV_IP || '192.168.1.4';
const LOCAL_ADDR = process.env.LOCAL_ADDR || '192.168.1.5'; // 绑定物理网卡绕过 VPN

function parseArgs(argv) {
    const cmd = argv[0];
    const arg = argv[1];
    if (cmd === 'get') return { cmd };
    if (cmd === 'pair') return { cmd };
    if (cmd === 'info') return { cmd };
    if (cmd === 'set') {
        const v = parseInt(arg, 10);
        if (Number.isNaN(v) || v < 0 || v > 100) {
            throw new Error(`set 需要一个 0-100 的数值,收到: ${arg}`);
        }
        return { cmd, value: v };
    }
    if (cmd === 'step') {
        const m = /^([+-])(\d+)$/.exec(String(arg || '').trim());
        if (!m) {
            throw new Error(`step 需要形如 +1 / -1 的参数,收到: ${arg}`);
        }
        const delta = m[1] === '+' ? parseInt(m[2], 10) : -parseInt(m[2], 10);
        return { cmd, delta };
    }
    throw new Error(`未知命令: ${cmd || '(空)'}\n用法: get | set <0-100> | step <+n|-n> | pair | info`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    // 已有 client-key 则复用,否则需要配对(首次会弹电视确认)
    let clientKey = loadClientKeyFor(PROJECT_ROOT, TV_IP);
    const client = new WebOSTVClient({
        host: TV_IP,
        localAddress: LOCAL_ADDR,
        clientKey: clientKey || undefined,
    });

    console.log(`[电视] ${TV_IP} (源地址 ${LOCAL_ADDR})${clientKey ? ' 已有 client-key' : ' 未配对'}`);
    const { clientKey: newKey, tvInfo } = await client.connect();
    if (newKey && newKey !== clientKey) {
        saveClientKey(PROJECT_ROOT, TV_IP, newKey);
        console.log(`[配对] 已保存 client-key: ${newKey}`);
    }
    if (tvInfo && tvInfo.modelName) {
        console.log(`[电视] ${tvInfo.modelName} / webOS ${tvInfo.deviceOSVersion || ''}`);
    }

    let result;
    switch (args.cmd) {
        case 'get': {
            const v = await readBacklight(client);
            console.log(`[亮度] backlight = ${v}`);
            result = v;
            break;
        }
        case 'set': {
            const before = await readBacklight(client);
            await setBacklight(client, args.value);
            const after = await readBacklight(client);
            console.log(`[亮度] ${before} -> ${after} ${after === String(args.value) ? '✅ 已生效' : '❌ 未生效'}`);
            result = after;
            break;
        }
        case 'step': {
            const { from, to } = await stepBacklight(client, args.delta);
            const after = await readBacklight(client);
            console.log(`[亮度] ${from} ${args.delta > 0 ? '+' : ''}${args.delta} -> ${to} (读回 ${after}) ${after === to ? '✅' : '❌'}`);
            result = after;
            break;
        }
        case 'pair': {
            console.log(`[配对] 成功,client-key: ${newKey}`);
            result = newKey;
            break;
        }
        case 'info': {
            const all = await readPictureSettings(client);
            for (const [k, v] of Object.entries(all)) {
                console.log(`[picture] ${k} = ${v}`);
            }
            result = all;
            break;
        }
        default:
            throw new Error(`未实现命令: ${args.cmd}`);
    }

    client.close();
    process.exit(0);
}

main().catch((e) => {
    console.error(`[错误] ${e.message}`);
    process.exit(1);
});
