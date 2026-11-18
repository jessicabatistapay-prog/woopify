import { createInterface } from 'node:readline/promises';
import { closeDb } from './lib/db.js';
import { migrate } from './lib/migrate.js';
import { createUser } from './services/auth.js';
import { deliveryUrl, getShop, webhookSecret } from './services/shop.js';

async function prompt(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    const out = rl as any;
    out._writeToOutput = (s: string) => out.output.write(s.includes(question) ? s : '*');
  }
  const a = await rl.question(question);
  rl.close();
  if (hidden) process.stdout.write('\n');
  return a.trim();
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'migrate':
      await migrate();
      break;
    case 'create-admin': {
      await migrate(() => undefined);
      const email = args[0] || process.env.ADMIN_EMAIL || (await prompt('Email quản trị: '));
      const password = process.env.ADMIN_PASSWORD || (await prompt('Mật khẩu (≥10 ký tự): ', true));
      const u = await createUser(email, password, 'Chủ shop');
      console.log(`Đã tạo/cập nhật tài khoản #${u?.id} ${email}`);
      break;
    }
    case 'webhook-info': {
      const shop = await getShop();
      if (!shop) throw new Error('Chưa kết nối shop');
      console.log(`Delivery URL : ${deliveryUrl(shop.id)}`);
      console.log(`Secret       : ${webhookSecret(shop)}`);
      console.log('Topics       : order.created, order.updated, order.deleted, order.restored, product.created, product.updated, product.deleted');
      console.log('API version  : WP REST API Integration v3');
      break;
    }
    default:
      console.log('Lệnh: migrate | create-admin [email] | webhook-info');
  }
  await closeDb();
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await closeDb();
  process.exit(1);
});
