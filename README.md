# منصة الدورات (نسخة تجريبية)

منصة بسيطة لإدارة الدورات والواجبات ومتابعة أداء الطلاب، بثلاثة أدوار: **مدير** و**مشرف** و**طالب**.

> English summary at the end of this file.

## ماذا يفعل كل دور؟

| الدور | الصلاحيات |
|---|---|
| **المدير** | ينشئ الدورات والمجموعات، يدعو المشرفين والطلاب، يربط كل مجموعة بمشرف أو اثنين، ينشئ الواجبات ويرفق ملفاتها، يرى كل الحلول والدرجات، ولديه لوحة متابعة لكل الطلاب وتصدير Excel. |
| **المشرف** | يرى طلاب مجموعاته فقط، يصحح حلولهم (درجة + تعليق للطالب + ملاحظة داخلية)، ولديه لوحة متابعة لطلابه فقط. |
| **الطالب** | يرى واجباته، يرفع الحل (PDF أو صور، حتى 5 ملفات)، يعدّل حله قبل التصحيح، ويرى تعليق المشرف. |

### من يرى ماذا

| | الطالب صاحب الحل | مشرف مجموعته | مشرف مجموعة أخرى | طالب آخر | المدير |
|---|---|---|---|---|---|
| الحل المرفوع | ✅ | ✅ | ❌ | ❌ | ✅ |
| الدرجة | ❌ | ✅ | ❌ | ❌ | ✅ |
| تعليق للطالب | ✅ | ✅ | ❌ | ❌ | ✅ |
| ملاحظة داخلية | ❌ | ✅ | ❌ | ❌ | ✅ |

- الدرجة والملاحظة الداخلية لا تُرسلان إلى جهاز الطالب أصلاً (ليست مخفية بالشكل فقط).
- الملفات لا تُفتح إلا بعد فحص الصلاحية، حتى لو عرف أحد الرابط.
- لا يوجد تسجيل عام: الحسابات تُنشأ فقط بقبول رابط دعوة من المدير (صالح 7 أيام ولمرة واحدة).

## تشغيل النسخة التجريبية على جهازك

المتطلبات: Node.js 22.13 أو أحدث، و PostgreSQL 16.

أنشئ مستخدم قاعدة البيانات وقاعدتي التشغيل والاختبار (مرة واحدة):

```bash
sudo -u postgres psql -c "CREATE ROLE course LOGIN PASSWORD 'course'" -c "CREATE DATABASE course_platform OWNER course" -c "CREATE DATABASE course_platform_test OWNER course"
```

```bash
cp .env.example .env          # عدّل DATABASE_URL إذا لزم
npm ci
npm run db:migrate            # إنشاء جداول قاعدة البيانات
npm run db:seed               # بيانات تجريبية (اختياري)
npm run dev                   # http://localhost:3000
```

**حسابات البيانات التجريبية** (كلمة المرور لجميعها: `Demo@12345`):

| الحساب | الدور |
|---|---|
| admin@demo.test | مدير |
| khalid@demo.test, noura@demo.test, fahad@demo.test | مشرفون |
| abdullah@demo.test, sara@demo.test, lama@demo.test ... | طلاب |

لإنشاء حساب المدير الحقيقي بدلاً من البيانات التجريبية:

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='كلمة-مرور-طويلة' ADMIN_NAME='اسمك' npm run create-admin
```

## النقل إلى الدومين الحقيقي (خادم VPS)

الأسهل استخدام Docker على خادم لينكس صغير (2 معالج / 4GB ذاكرة يكفي للبداية):

1. انسخ المشروع إلى الخادم، ثم: `cp .env.example .env` وعدّل فيه:
   - `DB_PASSWORD` كلمة مرور قوية لقاعدة البيانات (تُعتمد عند أول تشغيل فقط؛ تغييرها لاحقاً يحتاج `ALTER USER course PASSWORD '...'` داخل قاعدة البيانات)
   - `APP_URL` رابط موقعك، مثل `https://courses.example.com`
   - `ADMIN_EMAIL` و `ADMIN_PASSWORD` و `ADMIN_NAME` لحساب المدير الأول
2. شغّل: `docker compose up -d --build` (يُنشئ الجداول تلقائياً عند كل تشغيل، ويعمل دائماً بوضع الإنتاج فيمنع تحميل البيانات التجريبية).
3. أنشئ حساب المدير: `docker compose exec app npm run create-admin`
4. ضع أمام المنفذ 3000 خادماً عكسياً يوفر HTTPS، مثل Caddy (يضيف عنوان الزائر تلقائياً، ويستخدمه الموقع للحد من محاولات الدخول):

   ```
   courses.example.com {
       request_body {
           max_size 60MB
       }
       header Strict-Transport-Security "max-age=31536000"
       reverse_proxy 127.0.0.1:3000
   }
   ```

عندما يبدأ `APP_URL` بـ `https://` تصبح ملفات تعريف الدخول (cookies) آمنة تلقائياً.

### النسخ الاحتياطي والاستعادة

احفظ **شيئين** كل يوم: قاعدة البيانات، ومجلد الملفات المرفوعة، ثم **انسخهما خارج الخادم** (مثلاً بمهمة cron يومية إلى تخزين سحابي)، لأن فقدان الخادم يُفقد النسخ المحفوظة عليه.

```bash
docker compose exec -T db pg_dump --clean --if-exists -U course course_platform > backup-$(date +%F).sql
docker compose cp app:/app/storage ./storage-backup-$(date +%F)
```

الاستعادة:

```bash
docker compose exec -T db psql -U course course_platform < backup-YYYY-MM-DD.sql
docker compose cp ./storage-backup-YYYY-MM-DD/. app:/app/storage
docker compose exec -u root app chown -R node:node /app/storage
```

## الملفات المقبولة

- صور PNG أو JPG أو WebP (حتى 10 ميجابايت للصورة)، و PDF (حتى 20 ميجابايت). حتى 5 ملفات في التسليم الواحد.
- يُفحص نوع الملف من محتواه لا من اسمه. الصور يُعاد حفظها فتُحذف منها البيانات المخفية (مثل موقع التصوير GPS).
- ملفات PDF المحمية بكلمة مرور تُرفض برسالة توضيحية.

## الاختبارات

```bash
npm test          # 53 اختباراً للصلاحيات والدعوات والرفع والحسابات (تحتاج قاعدة course_platform_test)
npm run test:e2e  # 35 فحصاً في متصفح حقيقي للأدوار الثلاثة مع لقطات شاشة (يحتاج الموقع شغالاً وبيانات تجريبية)
```

## غير موجود في هذه النسخة (يمكن إضافته لاحقاً)

- إرسال الروابط بالبريد تلقائياً: حالياً ينسخ المدير رابط الدعوة أو رابط «كلمة مرور جديدة» (من صفحة المستخدمين) ويرسله بالواتساب أو البريد.
- تطبيق جوال، تحقق بخطوتين، فحص فيروسات للملفات، منتدى نقاش.

---

## English summary

Invite-only course platform prototype: admins, supervisors (1–2 per group) and students. Students upload PDF/image solutions; supervisors grade them. Grades and internal notes are visible to staff only; students see feedback and status. Admin and supervisor dashboards show student performance (scoped to the supervisor's own groups).

Stack: Next.js 16 (App Router, server actions), React 19, TypeScript, PostgreSQL 16 + Drizzle ORM, Tailwind CSS 4, sharp and pdf-lib for upload checks. Files are stored on local disk behind a small storage interface (`src/lib/storage.ts`), referenced by key only, so moving to S3-compatible storage later does not touch the data. All access rules live in `src/lib/authz.ts`.

Run locally: `cp .env.example .env && npm ci && npm run db:migrate && npm run db:seed && npm run dev`. Deploy: `docker compose up -d --build` behind an HTTPS reverse proxy; set `APP_URL`, `DB_PASSWORD` and the `ADMIN_*` variables in `.env`, then `docker compose exec app npm run create-admin`.
