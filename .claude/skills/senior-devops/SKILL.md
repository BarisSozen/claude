---
name: senior-devops
description: Comprehensive DevOps skill for CI/CD, infrastructure automation, containerization, and cloud platforms (AWS, GCP, Azure). Includes pipeline setup, infrastructure as code, deployment automation, and monitoring. Use when setting up pipelines, deploying applications, managing infrastructure, implementing monitoring, or optimizing deployment processes.
---

# Senior DevOps

Complete toolkit for senior DevOps with modern tools and best practices.

## Quick Start

### Main Capabilities

This skill provides three core capabilities through automated scripts:

```bash
# Script 1: Pipeline Generator
python scripts/pipeline_generator.py [options]

# Script 2: Terraform Scaffolder
python scripts/terraform_scaffolder.py [options]

# Script 3: Deployment Manager
python scripts/deployment_manager.py [options]
```

## Core Capabilities

### 1. Pipeline Generator

Automated tool for CI/CD pipeline generation.

**Features:**
- GitHub Actions, CircleCI, GitLab CI support
- Multi-stage pipelines (build, test, deploy)
- Environment-specific configurations
- Secret management patterns

**Usage:**
```bash
python scripts/pipeline_generator.py <project-path> --platform github|circleci|gitlab
```

### 2. Terraform Scaffolder

Infrastructure as Code scaffolding and analysis.

**Features:**
- AWS, GCP, Azure module templates
- State management best practices
- Module composition patterns
- Security compliance checks

**Usage:**
```bash
python scripts/terraform_scaffolder.py <target-path> --provider aws|gcp|azure
```

### 3. Deployment Manager

Production deployment orchestration.

**Features:**
- Blue-green deployments
- Canary releases
- Rollback automation
- Health check integration

**Usage:**
```bash
python scripts/deployment_manager.py --strategy blue-green|canary|rolling
```

## Reference Documentation

### CI/CD Pipeline Guide

Comprehensive guide available in `references/cicd_pipeline_guide.md`:

- Pipeline architecture patterns
- Build optimization strategies
- Testing integration
- Artifact management
- Deployment triggers

### Infrastructure as Code

Complete IaC documentation in `references/infrastructure_as_code.md`:

- Terraform module patterns
- State management
- Environment separation
- Secret handling
- Cost optimization

### Deployment Strategies

Technical reference in `references/deployment_strategies.md`:

- Zero-downtime deployments
- Feature flags integration
- Monitoring and alerting
- Incident response
- Disaster recovery

## Tech Stack

**IaC:** Terraform, Pulumi, CloudFormation, CDK
**Containers:** Docker, Kubernetes, Helm, Kustomize
**CI/CD:** GitHub Actions, CircleCI, GitLab CI, Jenkins
**Cloud:** AWS, GCP, Azure
**Monitoring:** Prometheus, Grafana, Datadog, New Relic
**Security:** Vault, SOPS, AWS Secrets Manager

## Best Practices

### Pipeline Design
- Keep pipelines fast (< 10 min target)
- Parallelize independent stages
- Cache dependencies aggressively
- Fail fast on critical checks

### Infrastructure
- Use modules for reusability
- Tag all resources consistently
- Implement least privilege
- Plan before apply

### Deployments
- Always have rollback strategy
- Implement health checks
- Use progressive rollouts
- Monitor deployment metrics

### Security
- Rotate secrets regularly
- Scan images for vulnerabilities
- Use OIDC for cloud auth
- Encrypt data at rest and transit
