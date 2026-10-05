---
id: "zotero-users-21976164-QB73QCBV"
title: "Azure Container Apps Sandboxes overview (preview)"
source_type: "webpage"
source_url: "https://learn.microsoft.com/en-us/azure/container-apps/sandboxes-overview"
doi: null
captured_at: "2026-10-05T16:46:29Z"
published_at: null
authors: []
topics: ["Azure Container Apps Sandboxes","Isolated code execution","Stateful AI agent workspaces","Suspend and resume","Snapshots and persistent storage","Cloud resource lifecycle management","Networking policies","Identity and access management"]
evidence_status: "text"
processing: {"version":"2","model":"research-sol","processedAt":"2026-10-05T16:50:25.067Z"}
publication: {"status":"private"}
---

# Azure Container Apps Sandboxes overview \(preview\)

## Source facts

Authors not provided.



<https://learn.microsoft.com/en-us/azure/container-apps/sandboxes-overview>

## Machine interpretation

The source describes Azure Container Apps Sandboxes as isolated compute environments with programmable lifecycle control, OCI-based disk images, snapshots, persistent volumes, and networking policies\. It contrasts stateful sandboxes with apps, jobs, and dynamic sessions and outlines access requirements, architecture, resource tiers, and suspend behavior\. Performance, security, scalability, and cost statements are product claims rather than independently demonstrated findings in the supplied text\.

## Key findings

- The source identifies Microsoft\.App/SandboxGroups as the top-level Azure resource type, with sandboxes, images, snapshots, volumes, and secrets scoped to a sandbox group\.
- Sandbox lifecycle policies include idle auto-suspend, memory-and-disk or disk-only preservation, and auto-delete after a configured stopped period\.
- Management is split between an ARM control plane for sandbox groups and VNet connections and a data plane for individual sandboxes and their resources\.
- The source lists five resource tiers, ranging from 0\.25 CPU cores, 0\.5 GB memory, and 20 GB disk to 4 CPU cores, 8 GB memory, and 80 GB disk\.
- Azure Blob volumes can be mounted to multiple sandboxes simultaneously; Data Disk volumes are described as mountable to only one sandbox at a time\.
- Access requires Microsoft Entra ID and the Container Apps SandboxGroup Data Owner role; personal Microsoft accounts are not supported\.
- The source positions sandboxes as stateful, directly controlled environments, whereas dynamic sessions provide pool-managed, ephemeral execution\.

## Limitations

- No empirical study, benchmark methodology, sample size, or independent validation is provided\.
- Sub-second startup and restore claims do not specify workload conditions, image sizes, snapshot sizes, latency distributions, or regional constraints\.
- Strong-isolation claims are not accompanied by implementation details, threat models, security testing, or guarantees\.
- Scaling to thousands of concurrent sandboxes is asserted without quota details or measured scaling results\.
- The statement that stopped sandboxes incur no CPU or memory fees does not establish total cost; storage, snapshot, networking, and other charges are not specified\.
- Publication date, product availability status, author, and source URL are unavailable in the supplied text\.
- The comparisons with dynamic sessions are source-provided descriptions, not controlled evaluations\.

## Why this is relevant

- Provides architectural context for researching persistent, isolated execution environments for AI agents and generated code\.
- Supports descriptive comparison of Azure compute options by lifecycle, state persistence, storage, and developer control\.
- Identifies access, networking, and lifecycle constraints relevant to evaluating cloud sandbox platforms\.
- Highlights performance, isolation, scalability, and pricing claims that would require additional evidence for rigorous evaluation\.

## Evidence status

text


Human commentary belongs in notes.md and survives reprocessing.
