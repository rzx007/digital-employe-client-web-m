---
name: doc-coauthoring
description: "Use when the user wants to write technical docs, proposals, specifications, reports, bid documents, feasibility studies, or any substantial document. Triggers include requests like 'write a doc', 'draft a proposal', 'create a spec', '写一份文档', '写标书', '写技术方案', '写可行性报告', '写周报', '写总结', or any substantial writing task. This skill provides a structured co-authoring workflow with context gathering, clarifying questions, outline approval, chapter-by-chapter drafting, and reader testing."
argument-hint: "[topic or document type]"
user-invocable: true
---

# Doc Co-Authoring Workflow

Three-stage collaborative process for creating high-quality documents. Use this when the user asks to write any substantial document.

## Overview

| Stage | What | Tools |
|-------|------|-------|
| **1. Context Gathering** | Collect background, audience, format, constraints | `submit_clarifying_questions` (context=`long_document`) |
| **2. Refinement & Structure** | Outline approval, chapter-by-chapter drafting, iterative refinement | `submit_document_plan`, `write_file`, `edit_file` |
| **3. Reader Testing** | Validate the doc works for fresh readers | `submit_clarifying_questions`, `write_todos` |

## Workflow Rules

- **Same document task**: clarify gate + plan gate each interrupt **once**; after plan approval, write chapters directly — **never** call `submit_document_plan` again unless user `reject`s with revision feedback
- **Per-task subdirectory**: each document gets a unique `/artifacts/<doc-slug>/` derived from title (short kebab-case, e.g. `tech-proposal-acme-2026`)
- **Chapter files**: `/artifacts/<doc-slug>/chapter-N-标题.md` — one file per chapter, written sequentially
- **Final merge**: `/artifacts/<doc-slug>/完整版.md` (or user-specified name)
- **Assets**: `/artifacts/<doc-slug>/assets/` for images, tables, etc. (on demand)
- **No monolithic files**: never write the entire document body into a single file in one call — split into chapters first
- **No `/artifacts/` writes before plan approval**: the confirm gate in `submit_document_plan` is the unlock for all file writes in this task
- **Chat body rules**: never paste full chapter content into chat messages; mention the virtual path for download instead

## Stage 1: Context Gathering

Goal: close the gap between what the user knows and what you know, enabling smart guidance.

### 1a. Offer the workflow

When a writing task is detected, briefly offer the structured workflow:

> 我可以用三步协作流程来写这份文档：
> 1. **需求收集** — 了解背景、读者、格式要求
> 2. **大纲确认与分章写作** — 逐章节 brainstorm → 起草 → 精修
> 3. **读者测试** — 验证文档对新人是否清晰
>
> 想走这个流程，还是直接开始写？

If user declines, write freeform following the long-document conventions (slug, chapter files, merge). If user accepts, proceed.

### 1b. Initial questions

Call `submit_clarifying_questions` with `context="long_document"` and these questions:

(The UI shows a custom input under each choice question; free-text answers arrive as `其他：…`. Prefer 3–6 concrete options; no need for an "其他" option on every question.)

1. What type of document? (技术方案/标书/可行性报告/PRD/设计文档/周报/其他)
2. Who's the primary audience? (客户/领导/团队/评审专家/其他)
3. What outcome should the reader have after reading? (批准方案/理解设计/知晓进度/其他)
4. Is there a template or format to follow?
5. Any deadlines or page count constraints?

Let user know they can answer in shorthand or dump all context freely. After they respond, encourage them to dump more background:

- Project/problem background
- Why alternative approaches aren't used
- Stakeholder concerns
- Technical architecture or dependencies
- Related materials or references

### 1c. Follow-up clarification

Based on context gathered, call `submit_clarifying_questions` a second time if significant gaps remain (5-10 targeted questions). Topics to probe:

- Technical details that need explanation
- Trade-offs the reader should understand
- Assumptions the doc makes
- Risk areas or open issues

**Exit condition**: you can ask about edge cases and trade-offs without needing basics explained.

## Stage 2: Refinement & Structure

### 2a. Propose outline → submit_document_plan

Based on context, draft a document structure and call `submit_document_plan`:

- `title`: document title → derives `<doc-slug>`
- `outline`: structured outline (markdown, section headers + 1-line descriptions)
- `planned_artifacts`: JSON string array of planned files, e.g. `'["/artifacts/tech-proposal/chapter-01-背景.md","/artifacts/tech-proposal/chapter-02-需求分析.md","/artifacts/tech-proposal/完整版.md"]'`

The user can `approve` (start writing), `reject` (feedback → revise outline), or `edit` (directly modify outline).

### 2b. Chapter-by-chapter drafting

After approval, write chapters sequentially. For each chapter:

1. **Clarify** — briefly ask if any specifics to include (in conversation, not via tool)
2. **Brainstorm** — suggest 5-15 points that might belong in this chapter
3. **Curate** — ask user to pick what to keep/remove/combine
4. **Draft** — `write_file("/artifacts/<doc-slug>/chapter-N-标题.md", content)`
5. **Refine** — user reads, gives feedback → `edit_file` for surgical edits

Mermaid for architecture/flow, LaTeX for formulas. After 3 iterations with no substantial changes, ask if anything can be removed without losing value.

### 2c. Gap check between chapters

After each chapter, ask: "还有什么遗漏的吗，或者直接进入下一章？"

### 2d. Final merge & review

When all chapters are done:

1. Read all chapter files
2. Check for flow, consistency, redundancy, contradictions
3. Merge into `/artifacts/<doc-slug>/完整版.md`
4. Provide the virtual path to user for download

## Stage 3: Reader Testing

Goal: verify the doc works for readers who haven't been in this conversation.

### 3a. Predict reader questions

Generate 5-10 questions a real reader would ask when discovering this doc. For example:
- What problem does this solve?
- Who should care?
- What's the key decision/outcome?

### 3b. Self-test

Re-read the doc and check:
- Can each question be answered from the doc content alone?
- Are there ambiguous statements, false assumptions, contradictions?
- Does it assume context only the author knows?

### 3c. Fix gaps

For any gaps found:
- `edit_file` to fix specific sections
- If major restructure needed, inform user and propose changes

### 3d. Final handoff

When testing passes:

1. Recommend the user do their own final read-through
2. Suggest double-checking facts, links, technical details
3. Confirm the virtual path: `/artifacts/<doc-slug>/完整版.md`

## Specialized Document Types

### Technical Specification
- Background & problem statement
- System architecture (mermaid sequenceDiagram / flowchart)
- Module design (API, data model, interfaces)
- Implementation plan
- Risks & mitigation

### Bid Document / 标书
- Project overview
- Technical solution (architecture, key tech, advantages)
- Implementation plan & schedule
- Team & qualifications
- Risk management
- Pricing (if applicable)

### Weekly Report / 周报
- Key accomplishments this week
- Metrics & data (bullet points, tables)
- Blockers & risks
- Next week plan
