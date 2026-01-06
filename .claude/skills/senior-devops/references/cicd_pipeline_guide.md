# CI/CD Pipeline Guide

## Pipeline Architecture Patterns

### 1. Basic Pipeline Structure

```yaml
# GitHub Actions Example
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm test -- --coverage
      - uses: codecov/codecov-action@v4

  build:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          push: true
          tags: ghcr.io/${{ github.repository }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main'
    environment: production
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/deploy.sh
```

### 2. Matrix Builds

```yaml
test:
  runs-on: ubuntu-latest
  strategy:
    matrix:
      node-version: [18, 20, 22]
      os: [ubuntu-latest, macos-latest]
    fail-fast: false
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: ${{ matrix.node-version }}
    - run: npm ci && npm test
```

### 3. Reusable Workflows

```yaml
# .github/workflows/reusable-deploy.yml
name: Reusable Deploy

on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
      version:
        required: true
        type: string
    secrets:
      DEPLOY_TOKEN:
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    steps:
      - uses: actions/checkout@v4
      - run: ./deploy.sh ${{ inputs.version }}
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
```

## Build Optimization

### Caching Strategies

```yaml
# Node.js caching
- uses: actions/setup-node@v4
  with:
    node-version: '20'
    cache: 'npm'

# Docker layer caching
- uses: docker/build-push-action@v5
  with:
    cache-from: type=gha
    cache-to: type=gha,mode=max

# Custom caching
- uses: actions/cache@v4
  with:
    path: |
      ~/.cargo/registry
      ~/.cargo/git
      target
    key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}
    restore-keys: ${{ runner.os }}-cargo-
```

### Parallelization

```yaml
jobs:
  # These run in parallel
  lint:
    runs-on: ubuntu-latest
    steps: [...]

  typecheck:
    runs-on: ubuntu-latest
    steps: [...]

  unit-tests:
    runs-on: ubuntu-latest
    steps: [...]

  # This waits for all above
  integration-tests:
    needs: [lint, typecheck, unit-tests]
    runs-on: ubuntu-latest
    steps: [...]
```

## Secret Management

### GitHub Secrets Best Practices

```yaml
# Environment-specific secrets
deploy-staging:
  environment: staging
  steps:
    - run: deploy --token ${{ secrets.STAGING_TOKEN }}

deploy-production:
  environment: production
  steps:
    - run: deploy --token ${{ secrets.PROD_TOKEN }}

# OIDC for cloud providers (no long-lived secrets)
- uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::123456789:role/github-actions
    aws-region: us-east-1
```

## Testing Integration

### Test Stages

```yaml
test:
  runs-on: ubuntu-latest
  services:
    postgres:
      image: postgres:15
      env:
        POSTGRES_PASSWORD: test
      options: >-
        --health-cmd pg_isready
        --health-interval 10s
        --health-timeout 5s
        --health-retries 5
    redis:
      image: redis:7
      options: >-
        --health-cmd "redis-cli ping"
        --health-interval 10s
        --health-timeout 5s
        --health-retries 5
  steps:
    - uses: actions/checkout@v4
    - run: npm ci
    - run: npm run test:unit
    - run: npm run test:integration
      env:
        DATABASE_URL: postgres://postgres:test@localhost:5432/test
        REDIS_URL: redis://localhost:6379
    - run: npm run test:e2e
```

## Artifact Management

```yaml
build:
  steps:
    - run: npm run build
    - uses: actions/upload-artifact@v4
      with:
        name: dist
        path: dist/
        retention-days: 7

deploy:
  needs: build
  steps:
    - uses: actions/download-artifact@v4
      with:
        name: dist
        path: dist/
    - run: ./deploy.sh dist/
```

## Anti-Patterns to Avoid

1. **Hardcoded secrets** - Always use secret management
2. **No caching** - Dramatically slows pipelines
3. **Sequential when parallel possible** - Wastes time
4. **No artifact versioning** - Can't rollback reliably
5. **Testing in production** - Use staging environments
6. **No timeout limits** - Hung jobs waste resources
7. **No failure notifications** - Team unaware of issues

## Pipeline Metrics to Track

- Build time (target: < 10 min)
- Test coverage (target: > 80%)
- Deployment frequency
- Change failure rate
- Mean time to recovery
