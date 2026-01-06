#!/bin/bash
# ============================================================================
# INSTALL CLAUDE SKILLS SETUP
# ============================================================================
# Run this script in any project to add the user-level skills setup.
# Usage: curl -sL <url> | bash
#    OR: bash install-claude-skills.sh
# ============================================================================

set -e

PROJECT_DIR="${PWD}"
CLAUDE_DIR="${PROJECT_DIR}/.claude"
SCRIPTS_DIR="${CLAUDE_DIR}/scripts"

echo "[install] Setting up Claude skills for: ${PROJECT_DIR}"

# Create directories
mkdir -p "${SCRIPTS_DIR}"

# Create the setup script
cat > "${SCRIPTS_DIR}/setup-user-skills.sh" << 'SETUP_SCRIPT'
#!/bin/bash
set -e
SKILLS_DIR="${HOME}/.claude/skills"
echo "[setup-user-skills] Installing user-level skills..."
mkdir -p "${SKILLS_DIR}"

# error-detective
mkdir -p "${SKILLS_DIR}/error-detective"
cat > "${SKILLS_DIR}/error-detective/SKILL.md" << 'EOF'
---
name: error-detective
description: Expert error detective specializing in complex error pattern analysis, correlation, and root cause discovery. Masters distributed system debugging, error tracking, and anomaly detection with focus on finding hidden connections and preventing error cascades.
triggers: [error analysis, root cause, debug, stack trace, exception, log analysis]
preferred_architecture: microservices
---
# Error Detective
Senior error detective for analyzing complex error patterns and uncovering hidden root causes.
## Core Techniques
- Five Whys Framework
- Log Correlation with trace IDs
- Anomaly Detection with Z-score
EOF

# senior-architect
mkdir -p "${SKILLS_DIR}/senior-architect"
cat > "${SKILLS_DIR}/senior-architect/SKILL.md" << 'EOF'
---
name: senior-architect
description: Comprehensive software architecture skill with MICROSERVICES-FIRST approach. Expert in distributed systems, service mesh (Istio), event-driven architecture (Kafka), and cloud-native patterns.
preferred_architecture: microservices
---
# Senior Architect
## Microservices-First Principles
- Service decomposition via DDD
- Database-per-service pattern
- Async messaging (Kafka) for decoupling
- Circuit breakers, retry with backoff
- Distributed tracing (OpenTelemetry)
EOF

# senior-backend
mkdir -p "${SKILLS_DIR}/senior-backend"
cat > "${SKILLS_DIR}/senior-backend/SKILL.md" << 'EOF'
---
name: senior-backend
description: Comprehensive backend development skill for building scalable MICROSERVICES using NodeJS, Express, Go, Python, Postgres, GraphQL, gRPC.
preferred_architecture: microservices
---
# Senior Backend
## Microservices Patterns
- Database-per-service (no shared databases)
- Async messaging (Kafka) for event-driven flows
- gRPC for internal calls, REST for external
- Circuit breakers, health checks
EOF

# senior-frontend
mkdir -p "${SKILLS_DIR}/senior-frontend"
cat > "${SKILLS_DIR}/senior-frontend/SKILL.md" << 'EOF'
---
name: senior-frontend
description: Comprehensive frontend development skill for building modern web applications with MICROSERVICES integration. Expert in BFF pattern, micro-frontends.
preferred_architecture: microservices
---
# Senior Frontend
## Microservices Frontend Patterns
- Backend-for-Frontend (BFF) pattern
- TanStack Query for service data fetching
- Micro-frontends with module federation
EOF

# senior-fullstack
mkdir -p "${SKILLS_DIR}/senior-fullstack"
cat > "${SKILLS_DIR}/senior-fullstack/SKILL.md" << 'EOF'
---
name: senior-fullstack
description: Comprehensive fullstack development skill for building complete web applications with MICROSERVICES architecture.
preferred_architecture: microservices
---
# Senior Fullstack
## Patterns
- BFF pattern, GraphQL federation
- Database-per-service, event-driven (Kafka)
- Independent frontend/backend deployments
EOF

# senior-devops
mkdir -p "${SKILLS_DIR}/senior-devops"
cat > "${SKILLS_DIR}/senior-devops/SKILL.md" << 'EOF'
---
name: senior-devops
description: Comprehensive DevOps skill for MICROSERVICES deployment, Kubernetes orchestration, service mesh (Istio), GitOps patterns.
preferred_architecture: microservices
---
# Senior DevOps
## Microservices Deployment
- Kubernetes with HPA per service
- Istio service mesh (mTLS, traffic management)
- GitOps with ArgoCD/Flux
- Prometheus, Grafana, Jaeger observability
EOF

# senior-data-engineer
mkdir -p "${SKILLS_DIR}/senior-data-engineer"
cat > "${SKILLS_DIR}/senior-data-engineer/SKILL.md" << 'EOF'
---
name: senior-data-engineer
description: World-class data engineering skill for building scalable DATA MESH architecture with domain-oriented data products.
preferred_architecture: microservices
data_architecture: data-mesh
---
# Senior Data Engineer
## Data Mesh Patterns
- Domain-oriented data products
- Kafka as central nervous system
- Schema registry, data contracts
- Federated governance
EOF

# senior-data-scientist
mkdir -p "${SKILLS_DIR}/senior-data-scientist"
cat > "${SKILLS_DIR}/senior-data-scientist/SKILL.md" << 'EOF'
---
name: senior-data-scientist
description: World-class data science skill for statistical modeling, experimentation, causal inference, and advanced analytics.
---
# Senior Data Scientist
## Core Expertise
- Statistical modeling and inference
- A/B testing and experiment design
- Causal inference
- Feature engineering
EOF

# senior-ml-engineer
mkdir -p "${SKILLS_DIR}/senior-ml-engineer"
cat > "${SKILLS_DIR}/senior-ml-engineer/SKILL.md" << 'EOF'
---
name: senior-ml-engineer
description: World-class ML engineering skill for productionizing ML models, MLOps, LLM integration, RAG systems, and agentic AI.
---
# Senior ML/AI Engineer
## Core Expertise
- MLOps pipelines
- Model deployment and monitoring
- LLM integration and fine-tuning
- RAG system architecture
EOF

# quant-analyst
mkdir -p "${SKILLS_DIR}/quant-analyst"
cat > "${SKILLS_DIR}/quant-analyst/SKILL.md" << 'EOF'
---
name: quant-analyst
description: Expert quantitative analyst specializing in financial modeling, algorithmic trading, and risk analytics.
---
# Quant Analyst
## Core Competencies
- Derivatives pricing (Black-Scholes, Monte Carlo)
- Portfolio optimization (Markowitz, Black-Litterman)
- Trading strategies (stat arb, momentum, mean reversion)
- Risk models (VaR, CVaR)
EOF

# risk-manager
mkdir -p "${SKILLS_DIR}/risk-manager"
cat > "${SKILLS_DIR}/risk-manager/SKILL.md" << 'EOF'
---
name: risk-manager
description: Expert risk manager specializing in risk assessment, mitigation strategies, and compliance frameworks.
---
# Risk Manager
## Core Competencies
- Market, Credit, Operational, Liquidity Risk
- VaR, CVaR, Stress Testing
- Basel III/IV, COSO, ISO 31000
EOF

# frontend-design
mkdir -p "${SKILLS_DIR}/frontend-design"
cat > "${SKILLS_DIR}/frontend-design/SKILL.md" << 'EOF'
---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Avoids generic AI aesthetics.
---
# Frontend Design
## Guidelines
- Bold aesthetic direction
- Distinctive typography (avoid Inter, Arial)
- Cohesive color themes
- Motion and micro-interactions
EOF

# plotly
mkdir -p "${SKILLS_DIR}/plotly"
cat > "${SKILLS_DIR}/plotly/SKILL.md" << 'EOF'
---
name: plotly
description: Interactive scientific and statistical data visualization library for Python. 40+ chart types.
---
# Plotly
## Quick Start
```python
import plotly.express as px
fig = px.scatter(df, x='x', y='y')
fig.show()
```
EOF

# mcp-builder
mkdir -p "${SKILLS_DIR}/mcp-builder"
cat > "${SKILLS_DIR}/mcp-builder/SKILL.md" << 'EOF'
---
name: mcp-builder
description: Guide for creating MCP servers that enable LLMs to interact with external services.
---
# MCP Builder
## Quick Start (FastMCP)
```python
from mcp.server.fastmcp import FastMCP
mcp = FastMCP("my-server")
@mcp.tool()
def my_tool(param: str) -> str:
    return f"Result: {param}"
```
EOF

# skill-creator
mkdir -p "${SKILLS_DIR}/skill-creator"
cat > "${SKILLS_DIR}/skill-creator/SKILL.md" << 'EOF'
---
name: skill-creator
description: Guide for creating effective skills that extend Claude's capabilities.
---
# Skill Creator
## Structure
```
skill-name/
├── SKILL.md
├── references/
└── scripts/
```
EOF

# session-start-hook
mkdir -p "${SKILLS_DIR}/session-start-hook"
cat > "${SKILLS_DIR}/session-start-hook/SKILL.md" << 'EOF'
---
name: session-start-hook
description: Creating SessionStart hooks for Claude Code.
---
# Session Start Hook
## Usage
Add to .claude/settings.json:
```json
{"hooks":{"SessionStart":[{"matcher":"","hooks":[{"type":"command","command":"bash .claude/scripts/setup.sh"}]}]}}
```
EOF

echo "[setup-user-skills] Installed $(ls -1 ${SKILLS_DIR} | wc -l) skills to ${SKILLS_DIR}"
SETUP_SCRIPT

chmod +x "${SCRIPTS_DIR}/setup-user-skills.sh"

# Update or create settings.json
SETTINGS_FILE="${CLAUDE_DIR}/settings.json"
if [ -f "${SETTINGS_FILE}" ]; then
    # Check if SessionStart hook already exists
    if grep -q "SessionStart" "${SETTINGS_FILE}"; then
        echo "[install] SessionStart hook already exists in settings.json"
    else
        echo "[install] Adding SessionStart hook to existing settings.json"
        # Simple approach: backup and recreate
        cp "${SETTINGS_FILE}" "${SETTINGS_FILE}.bak"
        echo "[install] Backup saved to ${SETTINGS_FILE}.bak"
        echo "[install] Please manually add SessionStart hook to settings.json"
    fi
else
    # Create new settings.json
    cat > "${SETTINGS_FILE}" << 'SETTINGS'
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/scripts/setup-user-skills.sh",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
SETTINGS
    echo "[install] Created ${SETTINGS_FILE}"
fi

echo ""
echo "[install] Setup complete!"
echo ""
echo "Files created:"
echo "  - ${SCRIPTS_DIR}/setup-user-skills.sh"
echo "  - ${SETTINGS_FILE}"
echo ""
echo "Next steps:"
echo "  1. Commit these files to your repository"
echo "  2. Skills will auto-install on next Claude Code session"
