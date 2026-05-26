# Qichacha API Integration Notes

This patch adds a backend-proxied Qichacha interface so the frontend never exposes `QICHACHA_KEY` or `QICHACHA_SECRET`.

## Added / changed files

- `backend/app/services/qichacha_service.py`
  - Signs Qichacha requests using `Token = MD5(AppKey + Timespan + SecretKey).upper()`.
  - Supports the screenshot endpoint: `GET /ECIV4/GetBasicDetailsByName`.
  - Normalizes Qichacha status/message/hint for frontend debugging.
- `backend/app/routes.py`
  - Adds `GET /api/qichacha/status`.
  - Adds `GET /api/qichacha/company?keyword=...`.
  - Adds `POST /api/qichacha/company` with body `{ "keyword": "公司名" }`.
- `backend/app/services/investment_service.py`
  - Replaces the previous basic-company lookup with `/ECIV4/GetBasicDetailsByName`.
  - Keeps shareholder/financing calls as optional enrichment.
- `frontend/src/components/InvestmentPanel.jsx`
  - Adds a “Qichacha Direct Lookup” card.
  - Shows key fields and raw JSON for debugging.
- `backend/app/config.py` and `backend/.env.example`
  - Adds `QICHACHA_BASE_URL` and `QCC_PROXY` configuration.

## Required `.env` settings

```env
QICHACHA_KEY=你的AppKey
QICHACHA_SECRET=你的SecretKey
QICHACHA_BASE_URL=https://api.qichacha.com

# Optional: if your backend is outside mainland China and Qichacha blocks your IP
QCC_PROXY=http://your-mainland-china-proxy:port
```

## Local test

Backend:

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python run.py
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

API smoke test:

```bash
curl "http://127.0.0.1:5000/api/qichacha/status"
curl "http://127.0.0.1:5000/api/qichacha/company?keyword=小米科技有限责任公司"
```

## Common Qichacha errors

- `Status=121`: IP restriction. Deploy backend on a mainland China server or configure `QCC_PROXY`.
- `Status=115 / 214 / 107`: API not purchased, expired, or no permission for that specific endpoint.
- `Status=103`: key/secret issue. Recheck AppKey and SecretKey.
