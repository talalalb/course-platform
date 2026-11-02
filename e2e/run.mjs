/**
 * End-to-end smoke test + screenshots, run against a running server with fresh demo data:
 *   npm run db:seed -- --reset && npm run build && npm start   (in another terminal)
 *   npm run test:e2e
 * Uses the Playwright + Chromium already installed on the machine.
 */
import 'dotenv/config';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const PASSWORD = 'Demo@12345';
const SHOTS = path.resolve('docs/screenshots');
const results = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const one = async (q, params = []) => (await db.query(q, params)).rows[0];

async function login(browser, email, viewport = { width: 1280, height: 860 }) {
  const context = await browser.newContext({ viewport, locale: 'ar-SA' });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login')), page.click('button[type=submit]')]);
  return { context, page };
}

async function shot(page, name, fullPage = true) {
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch();

  // Fixtures from the demo seed.
  const pendingSara = await one(
    `SELECT s.id FROM submissions s JOIN users u ON u.id = s.student_id JOIN assignments a ON a.id = s.assignment_id
     WHERE u.email = 'sara@demo.test' AND a.title LIKE 'الواجب 2%'`,
  );
  const saraFile = await one(
    `SELECT f.id FROM submission_files f JOIN submissions s ON s.id = f.submission_id JOIN users u ON u.id = s.student_id
     WHERE u.email = 'sara@demo.test' LIMIT 1`,
  );
  const abdullahReviewed = await one(
    `SELECT a.id AS assignment_id, r.grade, r.internal_note FROM submissions s
     JOIN users u ON u.id = s.student_id JOIN assignments a ON a.id = s.assignment_id JOIN reviews r ON r.submission_id = s.id
     WHERE u.email = 'abdullah@demo.test' AND a.title LIKE 'الواجب 1%'`,
  );
  const openAssignment = await one(`SELECT id FROM assignments WHERE title LIKE 'الواجب 3%'`);
  const posterAssignment = await one(`SELECT id FROM assignments WHERE title LIKE 'تصميم بوستر%'`);
  const progGroupA = await one(
    `SELECT g.id FROM groups g JOIN courses c ON c.id = g.course_id WHERE c.title LIKE 'دورة أساسيات%' AND g.name = 'المجموعة أ'`,
  );
  const lamaSubmission = await one(
    `SELECT s.id FROM submissions s JOIN users u ON u.id = s.student_id WHERE u.email = 'lama@demo.test' LIMIT 1`,
  );

  // ---------------- No data leaks through redirects ----------------
  {
    const anon = await browser.newContext();
    for (const url of [`${BASE}/admin`, `${BASE}/admin/courses`, `${BASE}/admin/groups/${progGroupA.id}`]) {
      const res = await anon.request.get(url, { maxRedirects: 0 });
      const body = await res.text();
      check(`anonymous ${new URL(url).pathname} leaks no student data`, res.status() === 307 && !body.includes('حصة المطيري') && !body.includes('@demo.test'), `status ${res.status()}, ${body.length} bytes`);
    }
    await anon.close();
    const { context, page } = await login(browser, 'lama@demo.test');
    const res = await page.request.get(`${BASE}/admin`, { maxRedirects: 0 });
    const body = await res.text();
    check('a student requesting /admin gets no dashboard data', !body.includes('حصة المطيري') && !body.includes('متوسط الدرجات'), `${body.length} bytes`);
    await context.close();
  }

  let resetLink = '';
  // ---------------- Admin ----------------
  {
    const { context, page } = await login(browser, 'admin@demo.test');
    check('admin lands on admin dashboard', page.url().endsWith('/admin'), page.url());
    await shot(page, '01-admin-dashboard');
    const body = await page.textContent('body');
    check('admin dashboard shows group without supervisor', body.includes('بدون مشرف'));
    await page.goto(`${BASE}/admin/courses`);
    await shot(page, '02-admin-courses');
    await page.click('text=دورة أساسيات البرمجة');
    await page.waitForURL(/\/admin\/courses\//);
    await shot(page, '03-admin-course');
    const hw1Row = await page.locator('tr', { hasText: 'الواجب 1' }).textContent();
    check('course page shows real submission counts', /\b5\b/.test(hw1Row), hw1Row.replace(/\s+/g, ' ').slice(0, 80));
    await page.goto(`${BASE}/admin/groups/${progGroupA.id}`);
    await shot(page, '04-admin-group');

    // Invite a new student to group A and accept the invitation in a fresh browser.
    await page.fill('#student-name', 'طالب تجريبي جديد');
    await page.fill('#student-email', 'new.student@demo.test');
    await page.click('text=إضافة وإنشاء رابط دعوة');
    const linkEl = page.locator('code').first();
    await linkEl.waitFor();
    const inviteLink = (await linkEl.textContent()).trim();
    check('admin gets an invitation link', inviteLink.includes('/invite/'), inviteLink.slice(0, 40) + '…');
    await shot(page, '05-admin-invite-link', false);

    await page.goto(`${BASE}/admin/users`);
    await shot(page, '06-admin-users');
    const khalidRow = await page.locator('tr', { hasText: 'khalid@demo.test' }).textContent();
    check('users page lists each supervisor\'s groups', khalidRow.includes('المجموعة أ') && khalidRow.includes('المجموعة ب'));

    // Password reset link for a student
    const saraRow = page.locator('tr', { hasText: 'sara@demo.test' });
    await saraRow.locator('text=رابط كلمة مرور جديدة').click();
    const resetCode = saraRow.locator('code');
    await resetCode.waitFor();
    resetLink = (await resetCode.textContent()).trim();
    check('admin gets a password reset link', resetLink.includes('/reset/'));
    const csv = await page.request.get(`${BASE}/staff/export`);
    const csvText = await csv.text();
    check('admin CSV export includes students of all groups', csvText.includes('مها الرشيد') && csvText.includes('عبدالله الحربي'));
    await context.close();

    const guest = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const gp = await guest.newPage();
    const invitePath = new URL(inviteLink).pathname;
    await gp.goto(`${BASE}${invitePath}`);
    await shot(gp, '07-invite-accept', false);
    // Viewing must not consume the token: reload still shows the form.
    await gp.reload();
    check('viewing an invitation does not consume it', (await gp.locator('#password').count()) === 1);
    await gp.fill('#password', 'NewStudent#2026');
    await gp.fill('#confirm', 'NewStudent#2026');
    await Promise.all([gp.waitForURL(/\/student/), gp.click('button[type=submit]')]);
    check('accepted invitation signs the student in', gp.url().endsWith('/student'));
    await gp.goto(`${BASE}${invitePath}`);
    check('invitation link cannot be used twice', (await gp.textContent('body')).includes('غير صالح'));

    // Logout from the real button, then the session must be gone.
    await gp.goto(`${BASE}/student`);
    await Promise.all([gp.waitForURL(/\/login/), gp.click('text=خروج')]);
    await gp.goto(`${BASE}/student`);
    check('logout really ends the session', gp.url().includes('/login'), gp.url());
    await guest.close();
  }

  // ---------------- Password reset ----------------
  {
    const ctx = await browser.newContext();
    const rp = await ctx.newPage();
    await rp.goto(`${BASE}${new URL(resetLink).pathname}`);
    await rp.fill('#password', 'Sara#NewPass2026');
    await rp.fill('#confirm', 'Sara#NewPass2026');
    await Promise.all([rp.waitForURL(/\/student/), rp.click('button[type=submit]')]);
    check('password reset link signs the student in with the new password', rp.url().endsWith('/student'));
    await rp.goto(`${BASE}${new URL(resetLink).pathname}`);
    check('password reset link works only once', (await rp.textContent('body')).includes('غير صالح'));
    await ctx.close();
  }

  // ---------------- Supervisor ----------------
  {
    const { context, page } = await login(browser, 'noura@demo.test');
    check('supervisor lands on supervisor dashboard', page.url().endsWith('/supervisor'), page.url());
    await shot(page, '08-supervisor-dashboard');
    const body = await page.textContent('body');
    check('supervisor (group A only) does not see group B students', !body.includes('لمى السبيعي') && body.includes('سارة الدوسري'));

    await page.goto(`${BASE}/staff/submissions/${pendingSara.id}`);
    await shot(page, '09-supervisor-review');
    await page.fill('#grade', '150');
    await page.fill('#feedback', 'نص طويل كتبه المشرف ولا يجب أن يضيع');
    await page.click('text=حفظ التصحيح');
    await page.locator('text=الدرجة يجب أن تكون بين').waitFor();
    check('a rejected grade keeps the typed feedback', (await page.inputValue('#feedback')).includes('لا يجب أن يضيع'));
    await page.fill('#grade', '86');
    await page.fill('#feedback', 'حل ممتاز، أحسنتِ في تنظيم الحلقات.');
    await page.fill('#internalNote', 'ملاحظة سرية للمشرفين: تحسن واضح.');
    await page.click('text=حفظ التصحيح');
    await page.locator('text=تم حفظ التصحيح').waitFor();
    check('supervisor saves grade + feedback + internal note', true);

    const other = await page.request.get(`${BASE}/staff/submissions/${lamaSubmission.id}`);
    check('supervisor cannot open a submission from another group', other.status() === 404, `status ${other.status()}`);
    const csv = await (await page.request.get(`${BASE}/staff/export`)).text();
    check('supervisor CSV export only has own students', csv.includes('سارة الدوسري') && !csv.includes('لمى السبيعي') && !csv.includes('مها الرشيد'));
    await context.close();
  }
  {
    const { context, page } = await login(browser, 'fahad@demo.test');
    const res = await page.request.get(`${BASE}/files/s/${saraFile.id}`);
    check('supervisor of another course cannot download the file', res.status() === 404, `status ${res.status()}`);
    await context.close();
  }

  // ---------------- Student ----------------
  {
    const { context, page } = await login(browser, 'abdullah@demo.test');
    check('student lands on student page', page.url().endsWith('/student'), page.url());
    await shot(page, '10-student-home');
    await page.goto(`${BASE}/student/assignments/${abdullahReviewed.assignment_id}`);
    await shot(page, '11-student-feedback');
    const html = await page.content();
    check('student sees the feedback', html.includes('عمل ممتاز'));
    check('student page does not contain the grade', !html.includes(`${abdullahReviewed.grade} /`) && !html.includes('"grade"'));
    check('student page does not contain the internal note', !html.includes(abdullahReviewed.internal_note));

    const peerFile = await page.request.get(`${BASE}/files/s/${saraFile.id}`);
    check("student cannot download a classmate's file", peerFile.status() === 404, `status ${peerFile.status()}`);
    const staffPage = await page.request.get(`${BASE}/staff/submissions/${pendingSara.id}`, { maxRedirects: 0 });
    check('student is redirected away from staff pages', staffPage.status() === 307 || staffPage.status() === 303, `status ${staffPage.status()}`);
    const exportRes = await page.request.get(`${BASE}/staff/export`);
    check('student cannot export performance data', exportRes.status() === 404, `status ${exportRes.status()}`);

    // Upload a solution to the open assignment (replaces the earlier one).
    await page.goto(`${BASE}/student/assignments/${openAssignment.id}`);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    await page.setInputFiles('input[type=file]', { name: 'حل-الواجب.png', mimeType: 'image/png', buffer: png });
    await page.fill('#submission-note', 'هذه نسختي المعدلة.');
    page.once('dialog', (d) => d.accept());
    await page.click('text=استبدال الحل');
    await page.locator('text=تم التسليم بنجاح').waitFor({ timeout: 15000 });
    check('student replaces a submission before the deadline', true);
    await shot(page, '12-student-upload');

    // A disguised file is rejected.
    const fake = await page.request.post(`${BASE}/api/assignments/${openAssignment.id}/submission`, {
      headers: { Origin: BASE },
      multipart: { files: { name: 'virus.png', mimeType: 'image/png', buffer: Buffer.from('<html><script>alert(1)</script></html>') } },
    });
    check('upload of a disguised (non-image) file is rejected', fake.status() === 400, `status ${fake.status()}`);
    const crossSite = await page.request.post(`${BASE}/api/assignments/${openAssignment.id}/submission`, {
      headers: { Origin: 'https://evil.example' },
      multipart: { files: { name: 'a.png', mimeType: 'image/png', buffer: png } },
    });
    check('cross-site upload is blocked', crossSite.status() === 403, `status ${crossSite.status()}`);
    await context.close();
  }
  {
    // Student on a phone; Maha is not in the poster course group -> cannot see that assignment.
    const { context, page } = await login(browser, 'reem@demo.test', { width: 390, height: 844 });
    await shot(page, '13-student-mobile');
    await page.goto(`${BASE}/student/assignments/${posterAssignment.id}`);
    await shot(page, '14-student-assignment-mobile');
    await context.close();
  }
  {
    const { context, page } = await login(browser, 'maha@demo.test');
    const res = await page.request.get(`${BASE}/student/assignments/${openAssignment.id}`);
    check('student cannot open an assignment of a course they are not in', res.status() === 404, `status ${res.status()}`);
    await context.close();
  }

  await browser.close();
  await db.end();
  const failed = results.filter((r) => !r.ok);
  await writeFile(path.join(SHOTS, 'e2e-results.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await db.end().catch(() => {});
});
