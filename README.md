# Solana Meme Paper Trade

Web app paper trade meme coin tren Solana, tap trung vao quan ly von gia lap, vi the, lenh market/limit va PnL. App duoc toi uu cho mobile/PWA, dark mode, co dang nhap email/password de dong bo du lieu qua Supabase.

Live app: https://meme-paper-trade.vercel.app

Repo: https://github.com/etteehustle/meme-paper-trade

## Muc tieu

App nay dung de tap vao/ra lenh meme coin Solana ma khong can ket noi vi that. Don vi giao dich chinh la SOL, co tuy chon xem gia tri theo USD dua tren gia SOL market.

Nguoi dung co the:

- Paste contract address cua coin Solana de load thong tin gia/market cap tu DEX Screener.
- Xem market cap hien tai cua coin va trang thai refresh realtime.
- Quan ly tong von gia lap, cash kha dung, von dang reserved cho limit order, gia tri vi the va PnL.
- Mo vi the bang buy market hoac limit buy.
- Dong/bot vi the bang sell market hoac limit sell.
- Dat limit sell theo % vi the hoac theo gia tri vi the muon ban.
- Theo doi tung buy lot, entry, basis, recent fills va PnL theo tung vi the.
- Mo nhieu lenh buy cho cung mot coin va xem entry basis tong hop.
- Gia lap slippage, bribe fee va tx fee.
- Dang nhap de dong bo du lieu len Supabase database.

## Tech stack

- React 19
- TypeScript
- Vite
- Supabase Auth + Postgres
- DEX Screener token API
- Vercel deployment

## Cau truc source

```text
.
|-- index.html
|-- package.json
|-- vite.config.ts
|-- tsconfig.json
`-- src
    |-- App.tsx              # UI chinh, auth flow, order ticket, position tables
    |-- trading.ts           # Logic buy/sell, PnL, fee, limit fill
    |-- priceApi.ts          # Fetch token quote/SOL price tu DEX Screener
    |-- storage.ts           # Local cache fallback
    |-- cloudStorage.ts      # Supabase load/save/auth helpers
    |-- supabaseClient.ts    # Supabase client
    |-- types.ts             # Domain types
    |-- styles.css           # Dark UI, mobile/PWA behavior
    `-- main.tsx             # React entry
```

## Local development

Yeu cau:

- Node.js
- npm

Chay local:

```bash
npm install
npm run dev
```

App se chay tai:

```text
http://127.0.0.1:5173
```

Build production:

```bash
npm run build
```

Preview production build:

```bash
npm run preview
```

## Environment variables

App co fallback Supabase config trong `src/supabaseClient.ts`, nhung nen cau hinh env rieng khi deploy/develop:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
VITE_AUTH_REDIRECT_URL=https://meme-paper-trade.vercel.app
```

Ghi chu:

- `VITE_SUPABASE_URL`: Supabase project URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: publishable/anon key dung o frontend.
- `VITE_AUTH_REDIRECT_URL`: URL user se quay ve sau khi confirm email. Production nen tro ve domain Vercel chinh.

Khong dua service role key vao frontend.

## Supabase setup

### Auth

App dang dung email/password auth:

- User nhap email + password.
- Neu chua co tai khoan thi bam `Create account`.
- Supabase gui email confirm neu project dang bat `Confirm email`.
- Sau khi confirm email, user quay lai app va bam `Login`.
- Khi login thanh cong, app load state tu database.

Neu gap loi rate limit email cua Supabase free tier, can cau hinh custom SMTP trong Supabase Auth Emails de tang kha nang gui email cho nhieu user hon.

### Database table

App luu moi user vao bang `paper_trade_states`. Schema goi y:

```sql
create table if not exists public.paper_trade_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  positions jsonb not null default '[]'::jsonb,
  orders jsonb not null default '[]'::jsonb,
  trades jsonb not null default '[]'::jsonb,
  fees jsonb not null default '{}'::jsonb,
  account jsonb not null default '{}'::jsonb,
  usd_mode boolean default true,
  last_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### Row Level Security

Bat RLS va chi cho user doc/ghi row cua chinh ho:

```sql
alter table public.paper_trade_states enable row level security;

create policy "Users can read own paper trade state"
on public.paper_trade_states
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own paper trade state"
on public.paper_trade_states
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own paper trade state"
on public.paper_trade_states
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

Optional trigger de update `updated_at`:

```sql
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_paper_trade_states_updated_at on public.paper_trade_states;

create trigger set_paper_trade_states_updated_at
before update on public.paper_trade_states
for each row
execute function public.set_updated_at();
```

## Data model

State chinh cua app gom:

- `positions`: danh sach vi the dang mo.
- `orders`: lenh limit dang cho, da filled hoac cancelled.
- `trades`: recent fills da execute thanh cong.
- `fees`: slippage %, bribe fee SOL, tx fee SOL.
- `account`: tong von gia lap va cash kha dung.
- `usdMode`: che do hien thi USD/SOL.
- `lastAddress`: contract address gan nhat.

Khi user chua login, app van co local cache trong browser. Khi login thanh cong, app load state tu Supabase; neu user chua co row DB, app se migrate local state hien tai len DB.

## Trading behavior

### Market buy

- Dung `Buy capital` tinh bang SOL.
- App tru cash theo `capital + bribe fee + tx fee`.
- Gia fill = market price da apply slippage buy.
- Tao mot buy lot moi trong vi the cua coin.

### Market sell

- Ban theo % vi the.
- Gia fill = market price da apply slippage sell.
- Realized PnL = gross sell value - fees - cost basis bi ban.

### Limit buy

- Input limit theo market cap USD cua coin.
- App quy doi market cap sang implied SOL/token dua tren market cap va price hien tai.
- Khi gia coin cham dieu kien, order duoc fill tu dong.
- Von cho lenh limit buy duoc reserved de tranh dung qua tong von gia lap.

### Limit sell

- Input limit theo market cap USD cua coin.
- Co the chon ban theo `%` hoac theo `value`.
- Khi gia coin cham dieu kien, order duoc fill va ghi vao recent fills.

### Fees

Phi gia lap gom:

- `Slippage gia lap %`
- `Bribe fee SOL`
- `Tx fee SOL`

Phi duoc tinh vao cost basis khi buy va tru vao ket qua khi sell.

## Realtime price refresh

App fetch token quote tu DEX Screener:

```text
https://api.dexscreener.com/tokens/v1/solana/{contractAddress}
```

Gia coin duoc refresh moi 8 giay khi da load token. Vong tron indicator tren UI la countdown ring:

- Full ngay sau khi refresh xong.
- Giam dan theo thoi gian con lai.
- Ve 0 truoc lan fetch tiep theo.
- Khong phai loading spinner.

Gia SOL/USD duoc refresh moi 30 giay de ho tro che do hien thi USD.

## Mobile/PWA behavior

App duoc toi uu de cam giac gan nhu native app tren mobile:

- Viewport dung `viewport-fit=cover`.
- Chan unintended mobile browser zoom bang `maximum-scale=1, user-scalable=no`.
- Input mobile co computed font-size toi thieu 16px de tranh iOS Safari focus zoom.
- Button/link/form controls dung `touch-action: manipulation` de tranh double-tap zoom.
- Layout dung `100dvh` va safe-area padding cho iPhone notch/dynamic island.
- Khong co horizontal page overflow trong mobile viewport.

## Deployment

Production deploy tren Vercel:

```bash
npm run build
npx vercel@latest --prod --yes --project meme-paper-trade
```

Domain production hien tai:

```text
https://meme-paper-trade.vercel.app
```

Khi deploy can dam bao Vercel co cac env vars:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_AUTH_REDIRECT_URL`

## Common issues

### Supabase email rate limit exceeded

Loi:

```text
email rate limit exceeded
```

Nghia la Supabase project da gui qua gioi han email mac dinh. Cach xu ly:

- Cau hinh custom SMTP trong Supabase Auth Emails.
- Dung provider nhu Resend, SendGrid, Amazon SES hoac SMTP service rieng.
- Sau khi cau hinh SMTP, email signup/confirm se khong bi gioi han thap nhu email service mac dinh cua Supabase.

### Confirm email khong quay ve app

Kiem tra:

- Supabase Auth URL Configuration co dung Site URL production.
- Redirect URLs co include `https://meme-paper-trade.vercel.app`.
- `VITE_AUTH_REDIRECT_URL` tren Vercel tro dung domain production.

### Login thanh cong nhung khong thay data cu

App uu tien data tu Supabase khi user da co row `paper_trade_states`. Neu local cache co data nhung DB da ton tai row rieng, app se load DB state. Neu user moi chua co row, app migrate local state hien tai len DB.

## Scripts

```bash
npm run dev      # run Vite dev server
npm run build    # TypeScript check + production build
npm run preview  # preview production build locally
```

## Notes

Day la app paper trade/gia lap, khong thuc hien giao dich on-chain, khong ket noi wallet va khong phai cong cu tu van dau tu.
