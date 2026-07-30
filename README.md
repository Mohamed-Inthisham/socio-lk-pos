# SOCIO.LK POS 🛒

> A modern Point of Sale (POS) system designed for mobile shops and small retail businesses in Sri Lanka.

![Status](https://img.shields.io/badge/status-in--development-yellow)
![License](https://img.shields.io/badge/license-MIT-blue)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![Tailwind](https://img.shields.io/badge/Tailwind-v4-38B2AC?logo=tailwind-css)

---

## 📖 Overview

**SOCIO.LK POS** is a full-stack web application that helps mobile shop owners manage sales, inventory, customers, and staff in one place. Built with modern web technologies and designed mobile-first for use on tablets and phones.

### ✨ Key Features (Planned)

- 🔐 **Authentication & Role-Based Access** — Admin, Manager, Cashier roles
- 💰 **Point of Sale** — Fast checkout with barcode support
- 📦 **Inventory Management** — Track products, stock levels, suppliers
- 👥 **Customer Management** — Customer profiles, purchase history
- 📊 **Reports & Analytics** — Sales trends, top products, revenue insights
- 🧾 **Receipt Printing** — Thermal printer support
- 📱 **Mobile-First Design** — Works on tablets, phones, and desktops
- ☁️ **Cloud Deployment** — Hosted on AWS for reliability

---

## 🛠️ Tech Stack

### Frontend
- **React 19** (with Vite)
- **Tailwind CSS v4** (utility-first styling)
- **Redux Toolkit** (state management)
- **React Router** (navigation)
- **Lucide React** (icons)

### Backend
- **NestJS** (Node.js framework)
- **PostgreSQL** (database)
- **TypeORM** (ORM)
- **JWT** (authentication with rotating refresh tokens)
- **Zod** (env validation) + **class-validator** (DTOs)
- **Jest** + **Supertest** (unit and e2e testing)

### DevOps
- **GitHub** (version control)
- **AWS** (deployment - planned)
- **Git Flow** (branching strategy)

---

## 📂 Project Structure
socio-lk-pos/
├── frontend/          # React application
├── backend/           # NestJS API (coming soon)
├── docs/              # Project documentation
└── README.md          # You are here

---

## 🚀 Getting Started

See [docs/getting-started.md](./docs/getting-started.md) for detailed setup instructions.

**Quick Start:**

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/socio-lk-pos.git
cd socio-lk-pos/frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

---

## 📚 Documentation

- 📐 [Architecture & Tech Decisions](./docs/architecture.md)
- 🌿 [Git Workflow & Branching](./docs/git-workflow.md)
- 🏁 [Getting Started Guide](./docs/getting-started.md)
- 📝 [Changelog](./CHANGELOG.md)

---

## 🗺️ Roadmap

- [x] Project setup & folder structure
- [x] Login UI (responsive design)
- [x] Authentication with Redux Toolkit
- [x] Role-based access control (RBAC)
- [ ] Dashboard layout
- [ ] Product management module *(backend ✅ Phase 6.1 — frontend pending)*
- [ ] POS checkout flow
- [ ] Inventory tracking *(backend ✅ Phase 6.1 — frontend pending)*
- [ ] Reports & analytics
- [x] Backend API (NestJS)
- [x] PostgreSQL integration
- [ ] AWS deployment
---

## 👨‍💻 Author

**Mohamed Inthisham**
- GitHub: [Mohamed-Inthisham](https://github.com/Mohamed-Inthisham)
- Email: mohamed.inthisham999@gmail.com

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

---

⭐ **If you find this project useful, please give it a star!** ⭐