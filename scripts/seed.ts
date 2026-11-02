/**
 * Fills the database with fictional demo data.
 *   npm run db:seed            (only on an empty database)
 *   npm run db:seed -- --reset (deletes ALL data first; refused when APP_ENV=production)
 * All demo accounts use DEMO_PASSWORD (default: Demo@12345).
 */
import 'dotenv/config';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';
import { db, getPool } from '@/lib/db';
import {
  assignmentFiles,
  assignments,
  courses,
  groupStudents,
  groupSupervisors,
  groups,
  reviews,
  submissionFiles,
  submissions,
  users,
} from '@/lib/db/schema';
import { hashPassword } from '@/lib/auth/password';
import { newStorageKey, storage } from '@/lib/storage';

export const DEFAULT_DEMO_PASSWORD = 'Demo@12345';
const DAY = 24 * 60 * 60 * 1000;

async function makePng(title: string, color: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <rect x="40" y="40" width="1120" height="620" rx="24" fill="${color}" opacity="0.12"/>
    <text x="80" y="140" font-family="DejaVu Sans, Arial, sans-serif" font-size="48" fill="#111827">${title}</text>
    <polyline points="80,560 260,420 420,480 600,300 780,360 960,200 1120,260" fill="none" stroke="${color}" stroke-width="10"/>
    <circle cx="600" cy="300" r="16" fill="${color}"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function makePdf(lines: string[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  lines.forEach((line, i) => page.drawText(line, { x: 60, y: 760 - i * 28, size: i === 0 ? 22 : 14, font, color: rgb(0.1, 0.1, 0.2) }));
  return Buffer.from(await pdf.save());
}

async function storeFile(prefix: 'submissions' | 'attachments', data: Buffer, ext: 'png' | 'pdf') {
  const key = newStorageKey(prefix, ext);
  await storage.put(key, data);
  return { storageKey: key, sizeBytes: data.length, mimeType: ext === 'png' ? 'image/png' : 'application/pdf' };
}

async function main() {
  if (process.env.APP_ENV === 'production') throw new Error('Refusing to seed demo data when APP_ENV=production');
  const reset = process.argv.includes('--reset');
  const existing = await db.$count(users);
  if (existing > 0 && !reset) {
    console.log('Database already has users. Run with --reset to wipe it and load demo data.');
    return;
  }
  if (reset) {
    await db.execute(sql`TRUNCATE users, courses, invitations, sessions, stored_files RESTART IDENTITY CASCADE`);
  }
  const password = process.env.DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD;
  await loadDemoData(password);
  console.log('Demo data loaded. All demo accounts use the password:', password);
  console.log('  admin@demo.test (admin) | khalid@demo.test, noura@demo.test, fahad@demo.test (supervisors) | abdullah@demo.test ... (students)');
}

/** Inserts the fictional demo courses, people and work. Expects an empty database. */
export async function loadDemoData(password: string) {
  const passwordHash = await hashPassword(password);
  const mk = (name: string, email: string, role: 'admin' | 'supervisor' | 'student') => ({ name, email, role, passwordHash });

  const [admin] = await db.insert(users).values(mk('مدير المنصة', 'admin@demo.test', 'admin')).returning();
  const [khalid, noura, fahad] = await db
    .insert(users)
    .values([mk('خالد العتيبي', 'khalid@demo.test', 'supervisor'), mk('نورة القحطاني', 'noura@demo.test', 'supervisor'), mk('فهد الشمري', 'fahad@demo.test', 'supervisor')])
    .returning();
  const studentNames: [string, string][] = [
    ['عبدالله الحربي', 'abdullah'],
    ['سارة الدوسري', 'sara'],
    ['محمد الزهراني', 'mohammed'],
    ['لمى السبيعي', 'lama'],
    ['عمر الغامدي', 'omar'],
    ['حصة المطيري', 'hessa'],
    ['بدر العنزي', 'badr'],
    ['ريم الشهري', 'reem'],
    ['يوسف القرني', 'yousef'],
    ['مها الرشيد', 'maha'],
  ];
  const students = await db
    .insert(users)
    .values(studentNames.map(([name, slug]) => mk(name, `${slug}@demo.test`, 'student')))
    .returning();
  const S = Object.fromEntries(studentNames.map(([, slug], i) => [slug, students[i]]));

  const [prog, design] = await db
    .insert(courses)
    .values([
      { title: 'دورة أساسيات البرمجة', description: 'مقدمة عملية في التفكير البرمجي ولغة Python.' },
      { title: 'دورة التصميم الجرافيكي', description: 'أساسيات التصميم والألوان والطباعة.' },
    ])
    .returning();

  const [progA, progB, designA, designB] = await db
    .insert(groups)
    .values([
      { courseId: prog.id, name: 'المجموعة أ' },
      { courseId: prog.id, name: 'المجموعة ب' },
      { courseId: design.id, name: 'المجموعة أ' },
      { courseId: design.id, name: 'المجموعة ب' },
    ])
    .returning();

  await db.insert(groupSupervisors).values([
    { groupId: progA.id, supervisorId: khalid.id },
    { groupId: progA.id, supervisorId: noura.id },
    { groupId: progB.id, supervisorId: khalid.id },
    { groupId: designA.id, supervisorId: fahad.id },
    // designB intentionally has no supervisor (shows the warning on the admin dashboard)
  ]);

  const enroll = (group: typeof progA, list: (typeof students)[number][]) =>
    list.map((s) => ({ groupId: group.id, courseId: group.courseId, studentId: s.id }));
  await db.insert(groupStudents).values([
    ...enroll(progA, [S.abdullah, S.sara, S.mohammed]),
    ...enroll(progB, [S.lama, S.omar, S.hessa, S.badr]),
    ...enroll(designA, [S.abdullah, S.reem, S.yousef]),
    ...enroll(designB, [S.maha]),
  ]);

  const now = Date.now();
  const [p1, p2, p3] = await db
    .insert(assignments)
    .values([
      {
        courseId: prog.id,
        title: 'الواجب 1: المتغيرات والشروط',
        description: 'اكتب برنامجاً يطلب من المستخدم عمره ويطبع رسالة مناسبة حسب الفئة العمرية.\nارفع صورة للكود ولقطة شاشة للتشغيل، أو ملف PDF.',
        dueAt: new Date(now - 10 * DAY),
        createdBy: admin.id,
      },
      {
        courseId: prog.id,
        title: 'الواجب 2: الحلقات التكرارية',
        description: 'اطبع جدول الضرب من 1 إلى 10 باستخدام حلقتين متداخلتين.',
        dueAt: new Date(now - 3 * DAY),
        createdBy: admin.id,
      },
      {
        courseId: prog.id,
        title: 'الواجب 3: الدوال',
        description: 'اكتب دالة تحسب متوسط قائمة أرقام، واختبرها على 3 قوائم مختلفة.',
        dueAt: new Date(now + 5 * DAY),
        createdBy: admin.id,
      },
    ])
    .returning();
  await db.insert(assignments).values({
    courseId: prog.id,
    title: 'المشروع النهائي (مسودة)',
    description: 'سيُنشر لاحقاً.',
    dueAt: new Date(now + 20 * DAY),
    isPublished: false,
    createdBy: admin.id,
  });
  const [d1, d2] = await db
    .insert(assignments)
    .values([
      {
        courseId: design.id,
        title: 'تصميم شعار لمقهى',
        description: 'صمم شعاراً بسيطاً بلونين فقط، وارفع الصورة النهائية وملف PDF يشرح الفكرة.',
        dueAt: new Date(now - 7 * DAY),
        maxScore: 20,
        createdBy: admin.id,
      },
      {
        courseId: design.id,
        title: 'تصميم بوستر فعالية',
        description: 'صمم بوستر بمقاس A4 لفعالية ثقافية.',
        dueAt: new Date(now + 3 * DAY),
        maxScore: 20,
        allowLate: false,
        createdBy: admin.id,
      },
    ])
    .returning();

  const brief = await storeFile('attachments', await makePdf(['Assignment brief', 'Logo design for a coffee shop', 'Use two colours only.']), 'pdf');
  await db.insert(assignmentFiles).values({ assignmentId: d1.id, originalName: 'وصف-الواجب.pdf', ...brief });

  type Plan = {
    assignment: typeof p1;
    student: (typeof students)[number];
    daysBeforeDue: number;
    review?: { grade: number; feedback: string; note: string; by: typeof khalid };
    pdf?: boolean;
  };
  const plans: Plan[] = [
    { assignment: p1, student: S.abdullah, daysBeforeDue: 2, review: { grade: 92, feedback: 'عمل ممتاز وتنظيم واضح للكود. انتبه لتسمية المتغيرات بالإنجليزية.', note: 'من أفضل الطلاب في المجموعة.', by: noura } },
    { assignment: p1, student: S.sara, daysBeforeDue: 1, review: { grade: 78, feedback: 'الحل صحيح، لكن ينقصه التعامل مع الإدخال غير الرقمي.', note: 'تحتاج متابعة في معالجة الأخطاء.', by: khalid }, pdf: true },
    { assignment: p1, student: S.lama, daysBeforeDue: 3, review: { grade: 85, feedback: 'جيد جداً. أضف تعليقات توضيحية.', note: '', by: khalid } },
    { assignment: p1, student: S.omar, daysBeforeDue: -1, review: { grade: 55, feedback: 'الحل غير مكتمل، راجع شرط الفئة الأخيرة.', note: 'سلّم متأخراً وتكرر الخطأ نفسه، يحتاج جلسة مراجعة.', by: khalid } },
    { assignment: p1, student: S.hessa, daysBeforeDue: 1, review: { grade: 88, feedback: 'ممتاز.', note: '', by: khalid } },
    { assignment: p2, student: S.abdullah, daysBeforeDue: 1 },
    { assignment: p2, student: S.sara, daysBeforeDue: 0.5, pdf: true },
    { assignment: p2, student: S.lama, daysBeforeDue: 1, review: { grade: 90, feedback: 'حل أنيق ومختصر.', note: '', by: khalid } },
    { assignment: p2, student: S.hessa, daysBeforeDue: -0.5 },
    { assignment: p3, student: S.abdullah, daysBeforeDue: 4 },
    { assignment: d1, student: S.reem, daysBeforeDue: 1, review: { grade: 18, feedback: 'فكرة جميلة واستخدام موفق للألوان.', note: '', by: fahad }, pdf: true },
    { assignment: d1, student: S.yousef, daysBeforeDue: 0.2, review: { grade: 11, feedback: 'الشعار مزدحم بالتفاصيل؛ جرّب التبسيط.', note: 'مستواه أقل من المتوقع، نتابعه.', by: fahad } },
    { assignment: d1, student: S.abdullah, daysBeforeDue: 2 },
    { assignment: d1, student: S.maha, daysBeforeDue: -2 },
  ];

  const colors = ['#4f46e5', '#059669', '#d97706', '#dc2626', '#0891b2'];
  for (const [i, plan] of plans.entries()) {
    const submittedAt = new Date(plan.assignment.dueAt.getTime() - plan.daysBeforeDue * DAY);
    const [sub] = await db
      .insert(submissions)
      .values({
        assignmentId: plan.assignment.id,
        studentId: plan.student.id,
        note: i % 3 === 0 ? 'أرفقت لقطة شاشة للتشغيل.' : '',
        isLate: submittedAt > plan.assignment.dueAt,
        submittedAt,
        status: plan.review ? 'reviewed' : 'submitted',
      })
      .returning();
    const png = await storeFile('submissions', await makePng(`Solution ${i + 1}`, colors[i % colors.length]), 'png');
    await db.insert(submissionFiles).values({ submissionId: sub.id, originalName: `حل-${i + 1}.png`, ...png });
    if (plan.pdf) {
      const pdf = await storeFile('submissions', await makePdf(['Student solution', `Submission #${i + 1}`, 'Demo file generated for the prototype.']), 'pdf');
      await db.insert(submissionFiles).values({ submissionId: sub.id, originalName: `الحل-${i + 1}.pdf`, ...pdf });
    }
    if (plan.review) {
      await db.insert(reviews).values({
        submissionId: sub.id,
        grade: plan.review.grade,
        feedback: plan.review.feedback,
        internalNote: plan.review.note,
        reviewedBy: plan.review.by.id,
        reviewedAt: new Date(submittedAt.getTime() + DAY),
      });
    }
  }
  void d2;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('scripts', 'seed.ts'));
if (isDirectRun) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => getPool().end());
}
