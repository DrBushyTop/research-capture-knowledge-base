# SQL Server containers on Apple Silicon

Researched on 2026-10-06. The question is what developers actually do when SQL Server containers crash on Apple Silicon, and which approaches fit this repository's M1 Max development machine. Reddit comments and issue reports describe individual experiences, not success rates. Local results below come from this machine's disposable probes.

## What works on this machine

Full SQL Server 2022 build `16.0.4295.3` exits with code 139 in under a second under QEMU. This happens in fresh containers without persistent data. The guest has enough memory and disk; disabling seccomp or SELinux labeling and running as root did not fix it.

The same SQL Server build starts in 7.4 seconds on a new AppleHV Podman VM with Rosetta and accepts the repository schema. Switching that same VM to QEMU 10.2.2 reproduces the crash. These experiments isolate the translation choice as the practical cause here.

Native ARM64 `mcr.microsoft.com/azure-sql-edge:1.0.7` also works. It starts in 4.7 seconds on the original libkrun VM, accepts the schema, and passes the existing SQL store integration test. That proves compatibility with the tested repository behavior, not every SQL Server feature.

The original VM and its four existing containers are running. The prepared AppleHV VM is stopped, and the app still connects to Azure SQL. The installed Podman only allows one active VM, so using full local SQL Server alongside Azurite requires moving those services to the AppleHV VM. Detailed probe results are in the ignored local note `.local/debug/podman-investigation.md`.

## Workarounds developers use

### Keep Podman, switch to AppleHV and explicitly enable Rosetta

The matching upstream report has SQL Server working in Docker Desktop and Rancher Desktop while Podman crashes. Users reported success with AppleHV and the guest-side `enable-rosetta` file in December 2025 and February 2026. In September 2026, a maintainer clarified that Podman 6 replaces that file with host configuration. [Podman issue 27078](https://github.com/podman-container-tools/podman/issues/27078)

Current host configuration for a newly created machine is:

```toml
[machine]
provider = "applehv"
rosetta = true
```

Podman's current documentation says Rosetta defaults to false and only supports AppleHV ARM64 machines. The macOS default provider is libkrun. Setting `rosetta = true` does not add Rosetta to an existing libkrun machine; create an AppleHV machine. [Current containers.conf documentation](https://github.com/podman-container-tools/container-libs/blob/main/common/docs/containers.conf.5.md#machine-table)

The older workaround was `podman machine ssh "sudo touch /etc/containers/enable-rosetta"`, followed by a machine restart. Treat that as advice for older releases. This machine already has the Podman 6 host setting and a working AppleHV VM.

Older Podman releases could show `"Rosetta": true` in machine inspection while the guest still used QEMU. A February 2026 report checked `/proc/sys/fs/binfmt_misc/rosetta` inside the VM to discover that mismatch. Check the registered guest interpreter when diagnosing a crash. [Podman Desktop Rosetta setting bug](https://github.com/podman-desktop/podman-desktop/issues/16168)

### Use Docker Desktop with Apple Virtualization Framework and Rosetta

In a May 2025 Reddit thread, the original poster later reported that enabling Docker's Rosetta option made SQL Server work on an M1. Other replies described daily use on Apple Silicon. [Reddit M1 SQL Server discussion](https://www.reddit.com/r/SQLServer/comments/1kxfek9/is_there_any_way_to_get_sqlserver_running_on_an/)

Docker's current settings expose the Rosetta checkbox only with Apple Virtualization Framework. Docker VMM currently lacks Rosetta support, so selecting that backend defeats this workaround. [Docker settings](https://docs.docker.com/desktop/settings-and-maintenance/settings/), [Docker VMM limitations](https://docs.docker.com/desktop/features/vmm/)

A November 2025 Podman thread and an April 2026 Docker thread also report SQL working in Docker while another runtime fails. This matches the runtime compatibility problem observed on this machine. [Reddit Podman report](https://www.reddit.com/r/podman/comments/1ozjeo3/mssql_2019_or_2022_on_arm_apple_m4/), [Reddit Docker report](https://www.reddit.com/r/docker/comments/1skazsp/docker_x86_on_apple_silicon_whats_it_like_in_2026/)

### Use Colima with VZ and Rosetta

Colima documents `colima start --vm-type=vz --vz-rosetta`. The VM remains ARM64; Rosetta translates the AMD64 container. Merely choosing a fully emulated x86 VM is a different setup. [Colima documentation](https://github.com/abiosoft/colima#virtual-machine)

March 2026 Reddit replies report using Colima for SQL, but the same thread includes failed attempts. A separate Colima reporter resolved SQL Server deaths by restarting and reducing VM memory; on a 32 GB Mac, an allocation of 16 GB reproduced the failure while 8 GB worked. That is one report, not proof that memory size caused this machine's immediate QEMU crash. [Reddit Colima discussion](https://www.reddit.com/r/SQLServer/comments/1s3nbgl/help_needed_running_mssql_2022_on_macos_no_docker/), [Colima issue 1536](https://github.com/abiosoft/colima/issues/1536)

### Switch to OrbStack

OrbStack documents Rosetta translation for AMD64 containers. In Microsoft's SQL 2025 issue, a December 2025 user reported the same image failing in Docker Desktop but working after switching to OrbStack. A February 2026 Reddit report describes the same workaround. This is a credible alternative, but we have not tested it here. [OrbStack documentation](https://docs.orbstack.dev/docker/#intel-x86-emulation), [SQL 2025 OrbStack report](https://github.com/microsoft/mssql-docker/issues/942#issuecomment-3623884445), [Reddit .NET development discussion](https://www.reddit.com/r/dotnet/comments/1qv2ss4/is_macbook_good_for_net_development/)

### Keep the frozen native SQL Edge image for temporary development

The old ARM64 SQL Edge image remains usable here without emulation. Microsoft retired ARM64 SQL Edge in September 2023, leaving existing registry images available without updates or support. The entire product retired on September 30, 2025. Retirement does not prevent an existing image from running. [ARM64 retirement announcement](https://techcommunity.microsoft.com/blog/sqlserver/azure-sql-edge-update---september-2023/3930827), [Product retirement](https://learn.microsoft.com/en-us/lifecycle/announcements/azure-products-retirement-september-2025)

Current Testcontainers examples still pin `azure-sql-edge:1.0.7`, so this testing fallback survives in the ecosystem despite Microsoft's retirement. [Testcontainers Go SQL Edge module](https://golang.testcontainers.org/modules/azure/#azure-sql-edge), [Testcontainers .NET example](https://testcontainers.com/modules/sqledge/)

This avoids moving the current containers. It also freezes the database engine on an old build. Developers who needed CLR moved from Edge to full SQL Server under Rosetta. [Reddit Edge migration discussion](https://www.reddit.com/r/webdev/comments/16uks3i/people_with_m1_chips_how_do_you_do_it_m1/)

## Version traps and recommendation

SQL Server 2025 has separate AVX/Rosetta failures. A January 2026 report verifies CU1 working in Docker Desktop, while a March 2026 Podman report says CU1 still fails there. Avoid treating every SQL crash as the same bug. [Docker Desktop CU1 success](https://github.com/microsoft/mssql-docker/issues/942#issuecomment-3821652228), [Podman CU1 failure](https://github.com/podman-container-tools/podman/issues/28184#issuecomment-4063651856)

FEX is not a demonstrated SQL replacement yet. The experimental podman-fex project lists SQL Server 2022 and 2025 as known failing tests. [podman-fex limitations](https://github.com/tnk4on/podman-fex#known-limitations)

For this machine, use the tested SQL Server 2022 build on AppleHV with Rosetta for ongoing local development. SQL Edge is a working temporary option when preserving the current VM matters more than using a maintained engine. Microsoft formally supports full SQL Server containers only on x86-64 Linux hosts; these Apple Silicon solutions are development workarounds. Azure SQL or an x86-64 database host avoids translation when supported behavior matters. [Microsoft container support policy](https://learn.microsoft.com/en-us/sql/linux/containers/deploy?view=sql-server-ver17)
