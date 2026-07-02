# Contributing to DeskOS

Thank you for your interest in contributing to DeskOS!

## Development Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Setup environment files:
   ```bash
   cp apps/backend/.env.example apps/backend/.env
   cp apps/frontend/.env.example apps/frontend/.env.local
   cp apps/agent/.env.example apps/agent/.env
   ```

4. Run development servers:
   ```bash
   npm run dev
   ```

## Code Style

- Use TypeScript for all new code
- Follow ESLint rules
- Format with Prettier
- Write tests for new features

## Commit Message Format

```
type(scope): subject

body

footer
```

Types: feat, fix, docs, style, refactor, test, chore

## Testing

```bash
npm run test
npm run test:coverage
```

## Building

```bash
npm run build
```
