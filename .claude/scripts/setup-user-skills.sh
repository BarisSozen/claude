#!/bin/bash
# ============================================================================
# USER-LEVEL SKILLS SETUP SCRIPT
# ============================================================================
# This script reinstalls all user-level skills at session start.
# Run manually: bash ~/.claude/scripts/setup-user-skills.sh
# Or configure as a SessionStart hook for automatic execution.
# ============================================================================

set -e

SKILLS_DIR="${HOME}/.claude/skills"
SCRIPT_VERSION="1.0.0"

echo "[setup-user-skills] v${SCRIPT_VERSION} - Installing user-level skills..."

mkdir -p "${SKILLS_DIR}"

# ============================================================================
# SKILL: error-detective
# ============================================================================
mkdir -p "${SKILLS_DIR}/error-detective"
cat > "${SKILLS_DIR}/error-detective/SKILL.md" << 'SKILL_EOF'
---
name: error-detective
description: Expert error detective specializing in complex error pattern analysis, correlation, and root cause discovery. Masters distributed system debugging, error tracking, and anomaly detection with focus on finding hidden connections and preventing error cascades.
version: "1.0.0"
tools: Read, Write, Edit, Bash, Glob, Grep
triggers:
  - error analysis
  - root cause
  - debug
  - stack trace
  - exception
  - failure investigation
  - log analysis
  - error correlation
  - cascade failure
  - anomaly detection
preferred_architecture: microservices
integration_with: microservices-architect
---

# Error Detective

Senior error detective with expertise in analyzing complex error patterns, correlating distributed system failures, and uncovering hidden root causes.

## When Invoked

1. Query context manager for error patterns and system architecture
2. Review error logs, traces, and system metrics across services
3. Analyze correlations, patterns, and cascade effects
4. Identify root causes and provide prevention strategies

## Core Techniques

### Five Whys Framework
Ask "Why?" iteratively to drill down to root cause.

### Log Correlation
- Use trace IDs to correlate across services
- Analyze temporal patterns
- Check for cascade effects

### Anomaly Detection
- Compare against baseline metrics
- Use Z-score for statistical anomalies
- Monitor error rate trends
SKILL_EOF
echo "[setup-user-skills] Created: error-detective"

# ============================================================================
# SKILL: senior-architect
# ============================================================================
mkdir -p "${SKILLS_DIR}/senior-architect"
cat > "${SKILLS_DIR}/senior-architect/SKILL.md" << 'SKILL_EOF'
---
name: senior-architect
description: Comprehensive software architecture skill with MICROSERVICES-FIRST approach. Expert in distributed systems, service mesh (Istio), event-driven architecture (Kafka), and cloud-native patterns. Designs scalable, maintainable systems using domain-driven design, service boundaries, and resilience patterns.
preferred_architecture: microservices
integration_with: microservices-architect
---

# Senior Architect

Complete toolkit for senior software architects with modern tools and best practices.

## Microservices-First Principles

**ALWAYS prefer microservices architecture** when designing new systems.

### Service Decomposition
- Identify bounded contexts via domain-driven design
- Define service boundaries around business capabilities
- Ensure database-per-service pattern
- Design for independent deployment

### Communication Patterns
- Prefer asynchronous messaging (Kafka, RabbitMQ) for decoupling
- Use gRPC for internal synchronous calls
- Implement API gateway for external access
- Apply saga pattern for distributed transactions

### Resilience Patterns
- Circuit breakers for fault tolerance
- Retry with exponential backoff
- Bulkhead isolation between services
- Graceful degradation with fallbacks
SKILL_EOF
echo "[setup-user-skills] Created: senior-architect"

# ============================================================================
# SKILL: senior-backend
# ============================================================================
mkdir -p "${SKILLS_DIR}/senior-backend"
cat > "${SKILLS_DIR}/senior-backend/SKILL.md" << 'SKILL_EOF'
---
name: senior-backend
description: Comprehensive backend development skill for building scalable MICROSERVICES using NodeJS, Express, Go, Python, Postgres, GraphQL, gRPC. Expert in service decomposition, database-per-service, event-driven communication (Kafka), and distributed systems patterns.
preferred_architecture: microservices
integration_with: microservices-architect
---

# Senior Backend

Complete toolkit for senior backend development with modern tools and best practices.

## Microservices Development Patterns

**ALWAYS build services with microservices patterns:**

### Service Design
- Single responsibility per service
- Database-per-service (no shared databases)
- API-first design with OpenAPI/gRPC definitions
- Stateless services for horizontal scaling

### Inter-Service Communication
- Async messaging (Kafka) for event-driven flows
- gRPC for low-latency internal calls
- REST for external API exposure
- Saga pattern for distributed transactions

### Resilience
- Circuit breakers (Opossum, resilience4j)
- Retry with exponential backoff
- Timeouts on all external calls
- Health check endpoints (/health/live, /health/ready)
SKILL_EOF
echo "[setup-user-skills] Created: senior-backend"

# ============================================================================
# SKILL: senior-frontend
# ============================================================================
mkdir -p "${SKILLS_DIR}/senior-frontend"
cat > "${SKILLS_DIR}/senior-frontend/SKILL.md" << 'SKILL_EOF'
---
name: senior-frontend
description: Comprehensive frontend development skill for building modern web applications with MICROSERVICES integration. Expert in Backend-for-Frontend (BFF) pattern, API gateway consumption, micro-frontends, and distributed state management.
preferred_architecture: microservices
integration_with: microservices-architect
---

# Senior Frontend

Complete toolkit for senior frontend development with modern tools and best practices.

## Microservices Frontend Patterns

**ALWAYS integrate with microservices architecture:**

### Backend-for-Frontend (BFF)
- Dedicated BFF per client type (web, mobile)
- API aggregation layer for multiple services
- Client-optimized data shaping
- Authentication/session handling in BFF

### Data Fetching
- TanStack Query for service data fetching
- Query key includes service identifier
- Optimistic updates with invalidation
- Error boundaries per service domain

### Micro-Frontends (when applicable)
- Module federation for large apps
- Independent deployment per team
- Shared component libraries
- Consistent design system
SKILL_EOF
echo "[setup-user-skills] Created: senior-frontend"

# ============================================================================
# SKILL: senior-fullstack
# ============================================================================
mkdir -p "${SKILLS_DIR}/senior-fullstack"
cat > "${SKILLS_DIR}/senior-fullstack/SKILL.md" << 'SKILL_EOF'
---
name: senior-fullstack
description: Comprehensive fullstack development skill for building complete web applications with MICROSERVICES architecture. React/Next.js frontend with BFF pattern, distributed backend services, event-driven communication, and cloud-native deployment.
preferred_architecture: microservices
integration_with: microservices-architect
---

# Senior Fullstack

Complete toolkit for senior fullstack development with modern tools and best practices.

## Microservices Fullstack Patterns

**ALWAYS design fullstack apps with microservices:**

### Frontend Architecture
- **Backend-for-Frontend (BFF)** pattern for each client type
- API Gateway aggregation layer
- Client-specific data shaping
- Independent frontend deployments

### Backend Services
- Decompose into domain-specific microservices
- Database-per-service pattern
- Event-driven communication (Kafka)
- Shared nothing architecture

### Integration Patterns
- GraphQL federation for unified API
- REST/gRPC for service-to-service
- WebSocket service for real-time features
- Message queues for async processing
SKILL_EOF
echo "[setup-user-skills] Created: senior-fullstack"

# ============================================================================
# SKILL: senior-devops
# ============================================================================
mkdir -p "${SKILLS_DIR}/senior-devops"
cat > "${SKILLS_DIR}/senior-devops/SKILL.md" << 'SKILL_EOF'
---
name: senior-devops
description: Comprehensive DevOps skill for MICROSERVICES deployment, Kubernetes orchestration, service mesh (Istio), and cloud-native infrastructure. Expert in container orchestration, CI/CD for distributed services, GitOps patterns, observability stack (Prometheus, Grafana, Jaeger).
preferred_architecture: microservices
integration_with: microservices-architect
---

# Senior DevOps

Complete toolkit for senior DevOps with modern tools and best practices.

## Microservices Deployment Patterns

**ALWAYS deploy with microservices infrastructure:**

### Kubernetes Orchestration
- Deployment per microservice
- HorizontalPodAutoscaler for each service
- Resource limits and requests defined
- Pod Disruption Budgets for availability

### Service Mesh (Istio)
- mTLS between all services
- Traffic management (canary, blue-green)
- Circuit breakers via DestinationRules
- Distributed tracing integration

### CI/CD for Microservices
- Independent pipelines per service
- GitOps with ArgoCD/Flux
- Canary deployments by default
- Automated rollback on failure
SKILL_EOF
echo "[setup-user-skills] Created: senior-devops"

# ============================================================================
# SKILL: senior-data-engineer
# ============================================================================
mkdir -p "${SKILLS_DIR}/senior-data-engineer"
cat > "${SKILLS_DIR}/senior-data-engineer/SKILL.md" << 'SKILL_EOF'
---
name: senior-data-engineer
description: World-class data engineering skill for building scalable DATA MESH architecture with domain-oriented data products. Expertise in event streaming (Kafka), data contracts, federated governance, and self-serve data platform.
preferred_architecture: microservices
data_architecture: data-mesh
integration_with: microservices-architect
---

# Senior Data Engineer

World-class senior data engineer skill for production-grade data systems.

## Data Mesh Patterns

**ALWAYS design data systems aligned with microservices:**

### Domain-Oriented Data Products
- Data ownership by domain teams
- Data products aligned with service boundaries
- Self-serve data infrastructure
- Federated computational governance

### Event-Driven Data Architecture
- Kafka as the central nervous system
- Event sourcing for audit trails
- CDC (Change Data Capture) from services
- Real-time data products

### Data Contracts
- Schema registry for all events
- Versioned data contracts
- Producer-consumer agreements
- Breaking change management
SKILL_EOF
echo "[setup-user-skills] Created: senior-data-engineer"

# ============================================================================
# SKILL: senior-data-scientist
# ============================================================================
mkdir -p "${SKILLS_DIR}/senior-data-scientist"
cat > "${SKILLS_DIR}/senior-data-scientist/SKILL.md" << 'SKILL_EOF'
---
name: senior-data-scientist
description: World-class data science skill for statistical modeling, experimentation, causal inference, and advanced analytics. Expertise in Python (NumPy, Pandas, Scikit-learn), R, SQL, statistical methods, A/B testing, time series, and business intelligence.
---

# Senior Data Scientist

World-class senior data scientist skill for production-grade AI/ML/Data systems.

## Core Expertise

- Statistical modeling and inference
- Experiment design and A/B testing
- Causal inference and analysis
- Feature engineering
- Model evaluation and selection
- Time series analysis
- Business intelligence and visualization
SKILL_EOF
echo "[setup-user-skills] Created: senior-data-scientist"

# ============================================================================
# SKILL: senior-ml-engineer
# ============================================================================
mkdir -p "${SKILLS_DIR}/senior-ml-engineer"
cat > "${SKILLS_DIR}/senior-ml-engineer/SKILL.md" << 'SKILL_EOF'
---
name: senior-ml-engineer
description: World-class ML engineering skill for productionizing ML models, MLOps, and building scalable ML systems. Expertise in PyTorch, TensorFlow, model deployment, feature stores, model monitoring, and ML infrastructure. Includes LLM integration, fine-tuning, RAG systems, and agentic AI.
---

# Senior ML/AI Engineer

World-class senior ML/AI engineer skill for production-grade AI/ML systems.

## Core Expertise

- ML model productionization
- MLOps pipelines and automation
- Feature stores and model registries
- Model monitoring and drift detection
- LLM integration and fine-tuning
- RAG system architecture
- Agentic AI frameworks
SKILL_EOF
echo "[setup-user-skills] Created: senior-ml-engineer"

# ============================================================================
# SKILL: quant-analyst
# ============================================================================
mkdir -p "${SKILLS_DIR}/quant-analyst"
cat > "${SKILLS_DIR}/quant-analyst/SKILL.md" << 'SKILL_EOF'
---
name: quant-analyst
description: Expert quantitative analyst specializing in financial modeling, algorithmic trading, and risk analytics. Masters statistical methods, derivatives pricing, and high-frequency trading with focus on mathematical rigor, performance optimization, and profitable strategy development.
---

# Quant Analyst

Senior quantitative analyst with expertise in developing sophisticated financial models and trading strategies.

## Core Competencies

### Financial Modeling
- Pricing models (options, bonds, derivatives)
- Risk models (VaR, CVaR, stress testing)
- Portfolio optimization (Markowitz, Black-Litterman)
- Factor models (Fama-French, Barra, custom factors)
- Volatility modeling (GARCH, stochastic vol)

### Trading Strategies
- Market making and liquidity provision
- Statistical arbitrage and pairs trading
- Momentum and trend following
- Mean reversion strategies
- Options strategies (vol arb, dispersion)
- Crypto and DeFi algorithms

### Risk Management
- Value at Risk (parametric, historical, Monte Carlo)
- Position sizing and Kelly criterion
- Stop-loss and drawdown control
- Portfolio hedging strategies
SKILL_EOF
echo "[setup-user-skills] Created: quant-analyst"

# ============================================================================
# SKILL: risk-manager
# ============================================================================
mkdir -p "${SKILLS_DIR}/risk-manager"
cat > "${SKILLS_DIR}/risk-manager/SKILL.md" << 'SKILL_EOF'
---
name: risk-manager
description: Expert risk manager specializing in comprehensive risk assessment, mitigation strategies, and compliance frameworks. Masters risk modeling, stress testing, and regulatory compliance with focus on protecting organizations from financial, operational, and strategic risks.
---

# Risk Manager

Senior risk manager with expertise in identifying, quantifying, and mitigating enterprise risks.

## Core Competencies

### Risk Categories
- **Market Risk**: Price, interest rate, currency, commodity, volatility
- **Credit Risk**: Default probability, loss given default, exposure at default
- **Operational Risk**: Process failures, fraud, business continuity
- **Liquidity Risk**: Funding, market liquidity, asset-liability mismatch

### Risk Quantification
- Value at Risk (VaR) - Parametric, Historical, Monte Carlo
- Expected Shortfall (CVaR)
- Stress Testing and Scenario Analysis
- Credit Scoring and PD/LGD/EAD Modeling
- Key Risk Indicators (KRIs)

### Regulatory Frameworks
- Basel III/IV Capital Requirements
- COSO Enterprise Risk Management
- ISO 31000 Risk Management Standard
SKILL_EOF
echo "[setup-user-skills] Created: risk-manager"

# ============================================================================
# SKILL: frontend-design
# ============================================================================
mkdir -p "${SKILLS_DIR}/frontend-design"
cat > "${SKILLS_DIR}/frontend-design/SKILL.md" << 'SKILL_EOF'
---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, or applications. Generates creative, polished code that avoids generic AI aesthetics.
---

# Frontend Design

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics.

## Design Thinking

Before coding, commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, etc.
- **Differentiation**: What makes this UNFORGETTABLE?

## Frontend Aesthetics Guidelines

- **Typography**: Choose distinctive, characterful fonts. Avoid Inter, Arial, Roboto.
- **Color & Theme**: Commit to a cohesive aesthetic. Dominant colors with sharp accents.
- **Motion**: Use animations for effects and micro-interactions.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap.
- **Backgrounds**: Create atmosphere with gradient meshes, noise textures, patterns.
SKILL_EOF
echo "[setup-user-skills] Created: frontend-design"

# ============================================================================
# SKILL: plotly
# ============================================================================
mkdir -p "${SKILLS_DIR}/plotly"
cat > "${SKILLS_DIR}/plotly/SKILL.md" << 'SKILL_EOF'
---
name: plotly
description: Interactive scientific and statistical data visualization library for Python. Use when creating charts, plots, or visualizations including scatter plots, line charts, bar charts, heatmaps, 3D plots, geographic maps, statistical distributions, financial charts, and dashboards.
---

# Plotly

Python graphing library for creating interactive, publication-quality visualizations with 40+ chart types.

## Quick Start

```python
import plotly.express as px
import pandas as pd

df = pd.DataFrame({'x': [1, 2, 3], 'y': [10, 11, 12]})
fig = px.scatter(df, x='x', y='y', title='My Plot')
fig.show()
```

## Chart Types

**Basic:** scatter, line, bar, pie, area, bubble
**Statistical:** histogram, box plot, violin, distribution
**Scientific:** heatmap, contour, ternary
**Financial:** candlestick, OHLC, waterfall
**Maps:** scatter maps, choropleth, density maps
**3D:** scatter3d, surface, mesh
**Specialized:** sunburst, treemap, sankey, gauge
SKILL_EOF
echo "[setup-user-skills] Created: plotly"

# ============================================================================
# SKILL: mcp-builder
# ============================================================================
mkdir -p "${SKILLS_DIR}/mcp-builder"
cat > "${SKILLS_DIR}/mcp-builder/SKILL.md" << 'SKILL_EOF'
---
name: mcp-builder
description: Guide for creating high-quality MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools. Use when building MCP servers to integrate external APIs or services.
---

# MCP Builder

Guide for creating MCP servers that enable LLMs to interact with external services.

## Quick Start (Python - FastMCP)

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("my-server")

@mcp.tool()
def my_tool(param: str) -> str:
    """Tool description."""
    return f"Result: {param}"

if __name__ == "__main__":
    mcp.run()
```

## Best Practices

1. **Clear tool descriptions** - LLMs use these to decide when to call tools
2. **Input validation** - Use JSON Schema for type safety
3. **Error handling** - Return meaningful error messages
4. **Idempotency** - Design tools to be safely retried
SKILL_EOF
echo "[setup-user-skills] Created: mcp-builder"

# ============================================================================
# SKILL: skill-creator
# ============================================================================
mkdir -p "${SKILLS_DIR}/skill-creator"
cat > "${SKILLS_DIR}/skill-creator/SKILL.md" << 'SKILL_EOF'
---
name: skill-creator
description: Guide for creating effective skills that extend Claude's capabilities with specialized knowledge, workflows, or tool integrations.
---

# Skill Creator

Guide for creating effective Claude Code skills.

## Skill Structure

```
skill-name/
├── SKILL.md           # Main skill definition (required)
├── references/        # Supporting documentation
│   └── *.md
└── scripts/           # Automation scripts
    └── *.py or *.sh
```

## SKILL.md Format

```yaml
---
name: skill-name
description: Clear description of what the skill does and when to use it.
triggers:
  - keyword1
  - keyword2
---

# Skill Name

Main content with instructions, patterns, and examples.
```
SKILL_EOF
echo "[setup-user-skills] Created: skill-creator"

# ============================================================================
# SKILL: session-start-hook
# ============================================================================
mkdir -p "${SKILLS_DIR}/session-start-hook"
cat > "${SKILLS_DIR}/session-start-hook/SKILL.md" << 'SKILL_EOF'
---
name: session-start-hook
description: Creating and developing startup hooks for Claude Code on the web. Use when the user wants to set up a repository for Claude Code on the web, create a SessionStart hook to ensure their project can run tests and linters during web sessions.
---

# Session Start Hook

Guide for creating SessionStart hooks for Claude Code.

## Hook Structure

Create `.claude/settings.json` in your project:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/scripts/session-start.sh",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

## Common Use Cases

1. **Install dependencies**: npm install or pip install
2. **Setup environment**: Create .env files
3. **Start services**: Database, Redis, etc.
4. **Verify toolchain**: Check required tools
SKILL_EOF
echo "[setup-user-skills] Created: session-start-hook"

# ============================================================================
# SUMMARY
# ============================================================================
echo ""
echo "[setup-user-skills] Installation complete!"
echo ""
echo "Installed skills:"
ls -1 "${SKILLS_DIR}" 2>/dev/null | while read skill; do
  echo "  - ${skill}"
done
echo ""
echo "Skills are available at: ${SKILLS_DIR}"
