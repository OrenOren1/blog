# orens-portfolio

My personal portfolio website built with [Astro](https://astro.build), featuring blog posts on DevOps, Platform Engineering, Kubernetes, GitOps, and AI/ML integration.

## Quick Start

```bash
npm install
npm run dev
```

Visit `http://localhost:4321` to view the site.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run format` | Format code with Prettier |

## Task Runner

You can also use [Task](https://taskfile.dev):

```bash
task setup    # Create Node environment + install deps
task dev      # Run dev server
task build    # Production build
task preview  # Preview production build
```

## Content Structure

```
src/content/blog/
├── kubernetes/      # K8s, EKS, OpenShift posts
├── gitops/          # ArgoCD, Crossplane, Terraform
├── ai-ml/           # AI/ML integration, LangFuse, RAG
├── platform/        # Platform engineering
└── *.md             # General posts
```

## Tech Stack

- **Astro 5.x** — Static site generator
- **View Transitions** — SPA-like navigation
- **TypeScript** — Type safety
- **GitHub Pages** — Hosting

## Deployment

Auto-deploys to GitHub Pages on push to `main` via GitHub Actions.

## License

Copyright (c) Oren Sultan. All rights reserved.