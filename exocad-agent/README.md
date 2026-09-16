# Exocad Agent

برنامج صغير يشتغل على جهاز التصميم (جنب Exocad).

## ماذا يفعل؟
- يراقب مجلد `CAD-Data`
- يقرأ ملفات `.dentalProject`
- يرسلها للسيرفر `/api/exocad/ingest`
- **لا ينشئ حالات** و**لا يغيّر الفواتير**
- الحالات **الخارجة** لا تُعدَّل على السيرفر

## التشغيل
1. انسخ `config.example.json` → `config.json`
2. عدّل `CAD_DATA_ROOT` و `EXOCAD_AGENT_SECRET` (نفس سر الطباعة أو سر مستقل)
3. على Railway ضع `EXOCAD_AGENT_SECRET` أو استخدم `PRINT_AGENT_SECRET`
4. شغّل:
```bat
cd exocad-agent
node agent.js
```

## ربط أسماء الدكاترة
من لوحة الأدمن → الأطباء → قسم Exocad:
- الاسم في النظام: `عماد عيد`
- الاسم في Exocad: `Emad Eid`
