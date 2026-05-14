# Getting Started

> A complete guide to setting up the SOCIO.LK POS project on your local machine.

---

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

| Tool | Version | Purpose | Download |
|------|---------|---------|----------|
| **Node.js** | 18.x or higher | JavaScript runtime | [nodejs.org](https://nodejs.org/) |
| **npm** | 9.x or higher | Package manager (comes with Node) | Included with Node.js |
| **Git** | 2.x or higher | Version control | [git-scm.com](https://git-scm.com/) |
| **VS Code** | Latest | Code editor (recommended) | [code.visualstudio.com](https://code.visualstudio.com/) |

### Verify Installation

Run these commands to verify everything is installed:

```bash
node --version    # Should show v18.x.x or higher
npm --version     # Should show 9.x.x or higher
git --version     # Should show git version 2.x.x
```

---

## 🚀 Installation

### Step 1: Clone the Repository

```bash
# Using HTTPS
git clone https://github.com/Mohamed-Inthisham/socio-lk-pos.git

# Or using SSH (if configured)
git clone git@github.com:Mohamed-Inthisham/socio-lk-pos.git

# Navigate into the project
cd socio-lk-pos
```

### Step 2: Install Frontend Dependencies

```bash
# Navigate to frontend folder
cd frontend

# Install all dependencies
npm install
```

This will install all packages listed in `package.json`, including:
- React 19
- Vite
- Tailwind CSS v4
- Redux Toolkit
- React Router
- Lucide React (icons)

### Step 3: Set Up Environment Variables (Future)

```bash
# Copy the example env file
cp .env.example .env

# Edit .env with your values
# (Not needed yet - no backend integration)
```

### Step 4: Start Development Server

```bash
# From the frontend folder
npm run dev
```

You should see output like:
VITE v5.x.x  ready in 432 ms
➜  Local:   http://localhost:5173/
➜  Network: use --host to expose

Open your browser and visit: **http://localhost:5173/**

You should see the login page! 🎉

---

## 📂 Project Structure
socio-lk-pos/
│
├── frontend/                  # React application
│   ├── public/                # Static assets
│   ├── src/
│   │   ├── assets/            # Images, logos
│   │   ├── components/        # Reusable components
│   │   │   ├── common/        # Shared components
│   │   │   └── auth/          # Auth-specific
│   │   ├── pages/             # Route pages
│   │   ├── store/             # Redux store (coming soon)
│   │   ├── hooks/             # Custom hooks (coming soon)
│   │   ├── utils/             # Helper functions
│   │   ├── App.jsx            # Root component
│   │   ├── main.jsx           # Entry point
│   │   └── index.css          # Global styles
│   ├── index.html             # HTML template
│   ├── package.json           # Dependencies
│   ├── vite.config.js         # Vite configuration
│   └── tailwind.config.js     # Tailwind configuration
│
├── backend/                   # NestJS API (coming soon)
│
├── docs/                      # Documentation
│   ├── architecture.md
│   ├── git-workflow.md
│   └── getting-started.md
│
├── .gitignore
├── README.md
└── CHANGELOG.md

---

## 🛠️ Available Scripts

Run these from the `frontend/` directory:

### Development

```bash
npm run dev
```
Starts the development server with hot reload at `http://localhost:5173`

### Build for Production

```bash
npm run build
```
Creates an optimized production build in the `dist/` folder

### Preview Production Build

```bash
npm run preview
```
Serves the production build locally to test before deploying

### Lint Code

```bash
npm run lint
```
Runs ESLint to check for code issues

---

## 🧪 Test Login Credentials

For development, use these mock credentials (any password works):

| Email | Role | Access Level |
|-------|------|--------------|
| `admin@socio.lk` | 👑 Admin | Full access |
| `manager@socio.lk` | 👔 Manager | Limited admin |
| `cashier@socio.lk` | 🛒 Cashier | View + Sales only |

> **Note:** These are mock credentials for development. Real authentication will be implemented with the backend.

---

## 🎨 Recommended VS Code Extensions

Install these for the best development experience:

| Extension | Purpose |
|-----------|---------|
| **ES7+ React/Redux/React-Native snippets** | Quick React snippets |
| **Tailwind CSS IntelliSense** | Autocomplete for Tailwind classes |
| **Prettier - Code formatter** | Consistent code formatting |
| **ESLint** | Code quality checks |
| **GitLens** | Enhanced Git capabilities |
| **Auto Rename Tag** | Auto-rename paired HTML/JSX tags |
| **Path Intellisense** | Autocomplete file paths |
| **Error Lens** | Inline error display |
| **Material Icon Theme** | Better file icons |
| **Thunder Client** | API testing (alternative to Postman) |

### Quick Install via Command

```bash
code --install-extension dsznajder.es7-react-js-snippets
code --install-extension bradlc.vscode-tailwindcss
code --install-extension esbenp.prettier-vscode
code --install-extension dbaeumer.vscode-eslint
code --install-extension eamodio.gitlens
```

---

## ⚙️ VS Code Settings (Recommended)

Create `.vscode/settings.json` in the project root:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "tailwindCSS.includeLanguages": {
    "javascript": "javascript",
    "html": "HTML"
  },
  "files.associations": {
    "*.css": "tailwindcss"
  },
  "emmet.includeLanguages": {
    "javascript": "javascriptreact"
  }
}
```

> **Note:** `.vscode/settings.json` should NOT be committed if it contains personal preferences. Only commit if it's project-wide standards.

---

## 🐛 Troubleshooting

### Issue: `npm install` fails

**Solution:**
```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules and lock file
rm -rf node_modules package-lock.json

# Reinstall
npm install
```

### Issue: Port 5173 already in use

**Solution:**
```bash
# Kill the process using port 5173 (Mac/Linux)
lsof -ti:5173 | xargs kill -9

# Or use a different port
npm run dev -- --port 3000
```

### Issue: Tailwind classes not working

**Solution:**
1. Check `index.css` has `@import "tailwindcss";` at the top
2. Restart the dev server
3. Verify the file is being imported in `main.jsx`
4. Clear browser cache

### Issue: Git push rejected

**Solution:**
```bash
# Pull latest changes first
git pull origin develop

# Resolve any conflicts
# Then push again
git push origin your-branch-name
```

### Issue: "Module not found" errors

**Solution:**
```bash
# Reinstall dependencies
npm install

# Restart dev server
npm run dev
```

### Issue: Changes not reflecting in browser

**Solution:**
- Hard refresh: `Ctrl + Shift + R` (Windows/Linux) or `Cmd + Shift + R` (Mac)
- Clear browser cache
- Check terminal for build errors

---

## 🌍 Browser Support

This project supports modern browsers:

- ✅ Chrome (last 2 versions)
- ✅ Firefox (last 2 versions)
- ✅ Safari (last 2 versions)
- ✅ Edge (last 2 versions)

**Not supported:**
- ❌ Internet Explorer (any version)

---

## 📱 Testing on Mobile Devices

To test on your phone/tablet during development:

```bash
# Start dev server with network access
npm run dev -- --host
```

You'll see output like:
➜  Local:   http://localhost:5173/
➜  Network: http://192.168.1.100:5173/

On your mobile device (connected to the **same WiFi**):
1. Open browser
2. Visit the Network URL (e.g., `http://192.168.1.100:5173/`)

---

## 🚢 Building for Production

### Step 1: Create Production Build

```bash
cd frontend
npm run build
```

This creates an optimized build in `frontend/dist/`

### Step 2: Test the Build

```bash
npm run preview
```

### Step 3: Deploy

Upload the `dist/` folder contents to your hosting service.

**Deployment options:**
- AWS S3 + CloudFront (planned)
- Vercel
- Netlify
- GitHub Pages

> Detailed deployment guide will be added in `docs/deployment.md`

---

## 🤝 Contributing

For contribution guidelines, see [docs/git-workflow.md](./git-workflow.md)

**Quick Contribution Steps:**

1. Create a new branch from `develop`:
```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/your-feature
```

2. Make your changes and commit:
```bash
   git add .
   git commit -m "feat(scope): your message"
```

3. Push and create a Pull Request:
```bash
   git push origin feature/your-feature
```

4. Open a PR on GitHub targeting `develop`

---

## 📞 Getting Help

If you run into issues:

1. **Check this guide** — Most common issues are covered
2. **Check existing issues** on GitHub
3. **Search the documentation** in `docs/`
4. **Contact the maintainer:**
   - GitHub: [@Mohamed-Inthisham](https://github.com/Mohamed-Inthisham)
   - Email: [mohamed.inthisham999@gmail.com](mailto:mohamed.inthisham999@gmail.com)

---

## ✅ Next Steps

Now that you're set up:

1. ✅ Familiarize yourself with the [Architecture](./architecture.md)
2. ✅ Review the [Git Workflow](./git-workflow.md)
3. ✅ Run the project and explore the login page
4. ✅ Pick a task and start coding!

---

**Last Updated:** May 2026

Happy coding! 🚀