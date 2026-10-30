# Mobile Phone Distribution & Salesman Hisab App

Dealer house থেকে salesman মাল নিয়ে retailer-দের কাছে বিক্রি করবে; পুরো হিসাব (মাল, টাকা, বাকি, পেমেন্ট, ফেরত) অ্যাপে থাকবে। Smartphone IMEI দিয়ে ট্র্যাক হবে, button phone quantity দিয়ে।

## ধাপ ১ — Backend (Lovable Cloud) ও Auth
- Lovable Cloud চালু + email/password auth enable (অ্যাডমিন নিজের অ্যাকাউন্ট খুলবেন, salesman-দের অ্যাকাউন্ট admin তৈরি করে দেবেন)।
- Migration: `profiles` (signup trigger-এ auto-create), `user_roles` (enum: admin/salesman), `has_role()` security-definer ফাংশন।
- বাকি টেবিল: `products`, `imei_units`, `stock_issues`, `stock_issue_items`, `retailers`, `sales`, `sale_items`, `retailer_payments`, `deposits`, `returns`, `settlements`।
- প্রতিটি টেবিলে RLS + GRANT: admin সব দেখবেন, salesman শুধু নিজের salesman_id-এর ডেটা। admin-ও RLS-এর নিয়মেই অ্যাক্সেস পাবেন (has_role দিয়ে)।

## ধাপ ২ — ডেটাবেস ফাংশন (IMEI validation সার্ভারে)
- IMEI status flow: `in_dealer_stock → with_salesman → sold`, ফেরতে `returned → in_dealer_stock`।
- Postgres ফাংশন: stock issue (IMEI-কে with_salesman-এ), বিক্রি (IMEI-কে sold), ফেরত (IMEI-কে in_dealer_stock-এ) — প্রতিটিতে status যাচাই; ভুল status/অপরিচিত IMEI হলে error ফেরত আসবে। Button phone-এ quantity-only।
- Sale তৈরির সময় unit_price = salesman-এর দেওয়া দাম (adjustable), বাকি = দাম − নেওয়া টাকা, retailer লেজারে স্বয়ংক্রিয়ভাবে ঢোকে।

## ধাপ ৩ — Admin অংশ
- `/products`: নাম, মডেল, দাম, ক্যাটাগরি (smartphone/button phone); smartphone হলে IMEI tracking; IMEI ইনপুট (scan/হাতে)।
- `/salesmen`: নতুন salesman অ্যাকাউন্ট তৈরি, active/inactive toggle।
- `/stock-issue`: salesman বেছে → product + quantity; smartphone হলে IMEI scan করে হস্তান্তর।
- `/retailers`: retailer যোগ/এডিট — **শুধু Admin** (salesman তালিকা থেকে বেছে নিবে)।
- Settlement তালিকা ও Dashboard/report: salesman-ভিত্তিক ও retailer-ভিত্তিক সারসংক্ষেপ (মাল, বিক্রি, জমা, ফেরত, বাকি)।

## ধাপ ৪ — Salesman অংশ (মোবাইল-বান্ধব)
- Dashboard: আমার হাতের মাল (কত পেয়েছি, কত বিক্রি, কত বাকি)।
- `/sales`: retailer বেছে → product + quantity + বিক্রয়মূল্য (adjustable) + নেওয়া টাকা/বাকি; smartphone হলে IMEI scan।
- `/retailers`-এ retailer লেজার: মাল, টাকা, বাকি — payment আনলে লেজারে ঢোকবে।
- Payment collection: retailer থেকে টাকা আদায়ের খতিয়ান।
- `/settlement`: ট্রিপ শেষে ফেরত (IMEI/quantity, damage সহ), টাকা জমা (deposit), বাকির হিসাব মেলানো।

## ধাপ ৫ — IMEI Scanner
- `html5-qrcode` দিয়ে barcode scan — ক্যামেরা চালু হবে শুধু scan বোতামে চাপলে; হাতে টাইপও করা যাবে।
- Validation: নেওয়ার ও ফেরতের সময় সার্ভারে IMEI মিলবে।
  - ভুল/অপরিচিত IMEI → ফোন **vibrate** (`navigator.vibrate`) + **লাল** সিগন্যাল।
  - ঠিক হলে → **সবুজ** সিগন্যাল, vibrate নেই।

## ধাপ ৬ — ভাষা ও হিসাব-ফরম্যাট
- পুরো অ্যাপে বাংলা ↔ ইংরেজি toggle; প্রথমবার ফোনের ভাষা অনুযায়ী (bn হলে বাংলা, নাহলে ইংরেজি), পরে পছন্দ localStorage-এ মনে থাকবে।
- টাকা ৳ চিহ্ন + **ইংরেজি সংখ্যা** (৳12,500)।

## ধাপ ৭ — যাচাই
- ছোট টেস্ট: ভুল IMEI ফেরত দিলে reject হবে; বিক্রির বাকি = দাম − টাকা; salesman নিজের ডেটা ছাড়া কিছু দেখতে পাবে না।
- Browser-এ admin ও salesman প্রবাহ একবার করে যাচাই; প্রতিটি route-এ নিজস্ব head() মেটাডেটা।

## পেজ তালিকা (সব `_authenticated` gate-এর নিচে)
`/auth`, `/dashboard`, `/products`, `/salesmen`, `/stock-issue`, `/sales`, `/retailers`, `/settlement`
