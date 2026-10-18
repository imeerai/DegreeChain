# DegreeChain

Blockchain-based academic credential verification. CEP for **Blockchain Technologies and Applications (CS-491)**, Scenario C, Department of Computer Systems Engineering, MUET Jamshoro.
Group: 22CS078, 22CS074, 22CS032. Submitted to Dr. Zartasha Baloch.

Universities record a **fingerprint** (salted SHA-256) of every degree, transcript or certificate on a permissioned Ethereum-compatible chain. The full record is stored **encrypted** (AES-256-GCM) off-chain, and the key is printed inside the QR code on the PDF. An employer scans the QR code, the browser decrypts the record, recomputes the fingerprint and asks the chain whether it is valid. No phone call to the university, and no personal data on the blockchain.

---

## 1. What is in this folder

| Path | What it is |
|---|---|
| `contracts/` | 5 Solidity files: `GovernanceCouncil`, `InstitutionRegistry`, `CredentialRegistry` and two interfaces |
| `test/DegreeChain.test.js` | 14 unit tests (Mocha/Chai) |
| `scripts/deploy.js` | Deploys the 3 contracts and accredits the 2 demo universities |
| `scripts/seed.js` | Issues the sample credentials and writes them to `samples/` |
| `scripts/measure.js` | Measures gas, throughput, block capacity and storage growth |
| `server/` | Node.js + Express backend (issuing, encryption, PDF/QR, verification API) |
| `public/` | Web UI: home, verify, university portal, council portal (plain HTML/CSS/JS) |
| `samples/` | Ready-made credentials (PDF + JSON) to test verification |
| `reports/` | Real outputs of tests, coverage, Slither and measurements |
| `docs/` | Viva Q&A, diagrams and screenshots |
| `public/deploy.html`, `api/`, `vercel.json` | Live deployment: MetaMask deploy page and Vercel entry point |

## 2. Requirements

- **Node.js 18 or newer** (tested on Node 22) and npm
- A web browser (Chrome, Edge or Firefox)
- Optional, for static analysis: Python 3.8+ and `pip install slither-analyzer`

The local demo needs no MetaMask or test ETH. The Solidity compiler (solc 0.8.24) comes from npm, so compiling works offline.
The live deployment (section 11) uses MetaMask, the Sepolia test network, Vercel and Supabase.

## 3. Installation

```bash
cd DegreeChain
npm install
copy .env.example .env      # Windows   (Linux/macOS: cp .env.example .env)
npx hardhat test            # should print "14 passing"
```

## 4. Running the system (3 terminals)

**Terminal 1 – start the local blockchain** (keep it open):
```bash
npm run chain
```

**Terminal 2 – deploy contracts and create sample credentials:**
```bash
npm run setup               # = npm run deploy && npm run seed
```

**Terminal 3 – start the web server:**
```bash
npm start
```
Open **http://localhost:3000**.

> If you restart `npm run chain`, the blockchain starts empty again. Run `npm run setup` again before `npm start`.

## 5. Demo logins

| Portal | Account | Password |
|---|---|---|
| University (`/university.html`) | MUET Jamshoro (Demo Node) or Partner University | `uni123` |
| Council (`/council.html`) | HEC Representative, University Representative, Independent Auditor | `council123` |

Change them in `.env`.

## 6. How to use it

**Verify a credential (employer / embassy)** – open `/verify.html`, then either
- upload one of the `.json` files from `samples/`, or
- open the link inside the QR code (listed in `samples/expected-results.json`), or scan the QR on a sample PDF with a phone that can reach your PC.

| Sample file | Expected result |
|---|---|
| `01-degree-valid` | VERIFIED |
| `02-transcript-valid` | VERIFIED |
| `03-microcredential-valid` | VERIFIED (issued by Partner University) |
| `04-degree-revoked` | REVOKED |
| `05a-transcript-superseded` | SUPERSEDED (points to the corrected one) |
| `05b-transcript-corrected` | VERIFIED |
| `06-degree-tampered.json` | NOT AUTHENTIC (CGPA changed 3.12 → 3.92) |

The samples are deterministic: on a fresh chain, `npm run setup` always produces the same IDs and keys, so these files keep working.

**Issue a credential (university)** – sign in at `/university.html`, fill the form, click *Sign & record on blockchain*. You get the PDF with QR code, the `.json` credential file and the verification link. From the list you can **Correct** (old one becomes *Superseded*), **Revoke**, or **Erase data** (deletes the encrypted record = right to erasure).

**Accredit or suspend (council)** – sign in at `/council.html` as a governor. Two of three governors must vote. Try voting for the *Unaccredited Institute* with two different governors and watch it become Active. The audit trail lists every on-chain event.

## 7. How it works (short)

1. Exam office submits the form. Server builds a JSON record with a random 128-bit salt.
2. Server computes SHA-256 of the canonical JSON and sends `issue(id, hash, kind)` to `CredentialRegistry`, signed with the university's key.
3. `CredentialRegistry` checks `InstitutionRegistry.isActive(msg.sender)`; that registry trusts only council-approved institutions.
4. The JSON is encrypted with a fresh AES-256-GCM key. The vault (`data/vault.json`) stores **only ciphertext**.
5. The PDF gets a QR code: `http://localhost:3000/verify.html#c=<id>&k=<key>`. The part after `#` is never sent to the server.
6. The verifier's browser downloads the ciphertext, decrypts it, recomputes the hash and calls `verify(id, hash)` (free, read-only).

## 8. Other commands

```bash
npm test                 # unit tests
npx hardhat coverage     # test coverage
npm run measure          # gas, TPS, block capacity, storage (output in reports/measurements.json)
slither .                # static analysis (needs slither-analyzer)
node server/lib/crypto.js   # self-check of hashing and encryption
```

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| `deployments/localhost.json not found` | Run `npm run setup` while `npm run chain` is running |
| Sample shows "No credential with this ID" | The chain was restarted. Run `npm run setup` again |
| `AlreadyExists` error during seed | Seed was run twice on the same chain. Restart `npm run chain`, then `npm run setup` |
| Port 3000 or 8545 busy | Change `PORT` in `.env`; stop other Hardhat nodes |
| QR does not open on phone | QR points to `localhost`. Set `PUBLIC_URL=http://<your-PC-IP>:3000` in `.env`, then rerun `npm run setup` |

## 10. Security note

This is a teaching prototype. The private keys come from Hardhat's public test mnemonic and the passwords are demo values. Never use them on a real network.

## 11. Live deployment (Sepolia testnet + Vercel)

The same code runs on the internet like any website. Where each part lives:

| Part | Local demo | Live deployment |
|---|---|---|
| Smart contracts | Hardhat node on `127.0.0.1:8545` | Ethereum **Sepolia** testnet (public, free test ETH) |
| Who deploys them | `npm run deploy` | Administrator's **MetaMask** wallet on `/deploy.html` |
| Web server + pages | `npm start` | **Vercel** (Node.js serverless function `api/index.js` + static `public/`) |
| Encrypted records | `data/vault.json` | **Supabase** PostgreSQL table `vault` (ciphertext only) |
| Operator keys | Hardhat test mnemonic | Fresh mnemonic in Vercel's encrypted environment variables |

Steps:

1. **Wallet.** Install MetaMask, turn on test networks, select *Sepolia*, and get free test ETH from a faucet
   (e.g. Google Cloud Web3 faucet).
2. **Operator wallets.** Create a new mnemonic for the council governors and universities and run
   `MNEMONIC="..." npx hardhat compile && MNEMONIC="..." node scripts/export-artifacts.js`.
   This writes `public/deploy-artifacts.json` (bytecode + the 6 wallet addresses, no keys).
3. **Database.** Create a free Supabase project and run:
   `create table vault (id text primary key, record jsonb not null);`
4. **Website.** Push the folder to GitHub, then on vercel.com: *Add New → Project → Import* the repository.
   Set the environment variables below and click *Deploy*.
5. **Contracts.** Open `https://<your-site>.vercel.app/deploy.html`, click *Connect MetaMask*, *Deploy 3 contracts*
   (confirm 3 times in MetaMask) and *Send* (gives gas to 4 operator wallets). Copy the value shown in step 4 of the page
   into the Vercel variable `DEPLOYED` and redeploy.
6. **Accredit.** On `/council.html`, sign in as two different governors and vote for each university (2 of 3).
7. Issue a credential on `/university.html`, scan its QR code with a phone and check it on `/verify.html`.
   Every transaction can be opened on https://sepolia.etherscan.io.

Vercel environment variables:

| Name | Value |
|---|---|
| `NETWORK` | `sepolia` |
| `RPC_URL` | `https://ethereum-sepolia-rpc.publicnode.com` |
| `MNEMONIC` | the operator mnemonic from step 2 (secret) |
| `DEPLOYED` | JSON printed by `/deploy.html` (contract addresses + deploy block) |
| `PUBLIC_URL` | `https://<your-site>.vercel.app` (goes into the QR codes) |
| `SUPABASE_URL`, `SUPABASE_KEY` | from the Supabase project settings |
| `UNIVERSITY_PASSWORD`, `COUNCIL_PASSWORD`, `SESSION_SECRET` | your own values |

Command-line alternative to step 5: `npx hardhat run scripts/deploy.js --network sepolia` (the mnemonic's first account pays the gas).
