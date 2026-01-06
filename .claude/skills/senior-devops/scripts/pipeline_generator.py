#!/usr/bin/env python3
"""
Pipeline Generator - Generates CI/CD pipeline configurations
Supports: GitHub Actions, CircleCI, GitLab CI
"""

import argparse
import os
from pathlib import Path

GITHUB_ACTIONS_TEMPLATE = """name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{{{ github.repository }}}}

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: '{package_manager}'
      - run: {install_cmd}
      - run: {lint_cmd}

  test:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: '{package_manager}'
      - run: {install_cmd}
      - run: {test_cmd}

  build:
    runs-on: ubuntu-latest
    needs: test
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ${{{{ env.REGISTRY }}}}
          username: ${{{{ github.actor }}}}
          password: ${{{{ secrets.GITHUB_TOKEN }}}}
      - uses: docker/build-push-action@v5
        with:
          context: .
          push: ${{{{ github.event_name != 'pull_request' }}}}
          tags: ${{{{ env.REGISTRY }}}}/${{{{ env.IMAGE_NAME }}}}:${{{{ github.sha }}}}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main'
    environment: production
    steps:
      - uses: actions/checkout@v4
      - name: Deploy
        run: echo "Add deployment commands here"
"""

CIRCLECI_TEMPLATE = """version: 2.1

orbs:
  node: circleci/node@5.1
  docker: circleci/docker@2.4

executors:
  node-executor:
    docker:
      - image: cimg/node:20.10

jobs:
  lint:
    executor: node-executor
    steps:
      - checkout
      - node/install-packages:
          pkg-manager: {package_manager}
      - run:
          name: Run linter
          command: {lint_cmd}

  test:
    executor: node-executor
    steps:
      - checkout
      - node/install-packages:
          pkg-manager: {package_manager}
      - run:
          name: Run tests
          command: {test_cmd}

  build:
    executor: docker/docker
    steps:
      - checkout
      - setup_remote_docker:
          docker_layer_caching: true
      - docker/build:
          image: $CIRCLE_PROJECT_REPONAME
          tag: $CIRCLE_SHA1

  deploy:
    executor: node-executor
    steps:
      - checkout
      - run:
          name: Deploy
          command: echo "Add deployment commands here"

workflows:
  build-and-deploy:
    jobs:
      - lint
      - test:
          requires:
            - lint
      - build:
          requires:
            - test
      - deploy:
          requires:
            - build
          filters:
            branches:
              only: main
"""

GITLAB_CI_TEMPLATE = """stages:
  - lint
  - test
  - build
  - deploy

variables:
  DOCKER_TLS_CERTDIR: "/certs"

default:
  image: node:20-alpine
  cache:
    key: $CI_COMMIT_REF_SLUG
    paths:
      - node_modules/

lint:
  stage: lint
  script:
    - {install_cmd}
    - {lint_cmd}

test:
  stage: test
  script:
    - {install_cmd}
    - {test_cmd}
  coverage: '/All files[^|]*\\|[^|]*\\s+([\\d\\.]+)/'

build:
  stage: build
  image: docker:24-dind
  services:
    - docker:24-dind
  script:
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
  rules:
    - if: $CI_COMMIT_BRANCH == "main"

deploy:
  stage: deploy
  script:
    - echo "Add deployment commands here"
  environment:
    name: production
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      when: manual
"""


def detect_project_type(project_path: Path) -> dict:
    """Detect project type and return configuration."""
    config = {
        "package_manager": "npm",
        "install_cmd": "npm ci",
        "lint_cmd": "npm run lint",
        "test_cmd": "npm test",
    }

    if (project_path / "pnpm-lock.yaml").exists():
        config["package_manager"] = "pnpm"
        config["install_cmd"] = "pnpm install --frozen-lockfile"
        config["lint_cmd"] = "pnpm lint"
        config["test_cmd"] = "pnpm test"
    elif (project_path / "yarn.lock").exists():
        config["package_manager"] = "yarn"
        config["install_cmd"] = "yarn install --frozen-lockfile"
        config["lint_cmd"] = "yarn lint"
        config["test_cmd"] = "yarn test"
    elif (project_path / "bun.lockb").exists():
        config["package_manager"] = "bun"
        config["install_cmd"] = "bun install --frozen-lockfile"
        config["lint_cmd"] = "bun run lint"
        config["test_cmd"] = "bun test"

    return config


def generate_pipeline(project_path: str, platform: str, output_path: str = None):
    """Generate CI/CD pipeline configuration."""
    project = Path(project_path)
    config = detect_project_type(project)

    templates = {
        "github": (GITHUB_ACTIONS_TEMPLATE, ".github/workflows/ci.yml"),
        "circleci": (CIRCLECI_TEMPLATE, ".circleci/config.yml"),
        "gitlab": (GITLAB_CI_TEMPLATE, ".gitlab-ci.yml"),
    }

    if platform not in templates:
        raise ValueError(f"Unsupported platform: {platform}")

    template, default_output = templates[platform]
    output = Path(output_path) if output_path else project / default_output

    # Create output directory if needed
    output.parent.mkdir(parents=True, exist_ok=True)

    # Generate pipeline
    content = template.format(**config)
    output.write_text(content)

    print(f"Generated {platform} pipeline: {output}")
    print(f"  Package manager: {config['package_manager']}")
    print(f"  Install command: {config['install_cmd']}")


def main():
    parser = argparse.ArgumentParser(description="Generate CI/CD pipeline configurations")
    parser.add_argument("project_path", help="Path to project directory")
    parser.add_argument(
        "--platform",
        choices=["github", "circleci", "gitlab"],
        default="github",
        help="CI/CD platform (default: github)",
    )
    parser.add_argument("--output", help="Output file path (optional)")

    args = parser.parse_args()
    generate_pipeline(args.project_path, args.platform, args.output)


if __name__ == "__main__":
    main()
