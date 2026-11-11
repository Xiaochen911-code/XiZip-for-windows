using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging;

namespace XiZip.Services;

/// <summary>本地 HTTP 服务：托管 Web 前端并翻译为 7-Zip 操作。</summary>
public sealed class ApiServer : IDisposable
{
    private const string AppVersion = "1.1.0";

    private static readonly Regex ProgressRegex = new(@"^\s*(\d{1,3})%", RegexOptions.Compiled);

    private static readonly JsonSerializerOptions ReadOptions = new(JsonSerializerDefaults.Web);

    private static readonly HashSet<string> TextExts = new(StringComparer.OrdinalIgnoreCase)
    {
        "txt", "md", "markdown", "json", "js", "mjs", "ts", "tsx", "jsx", "css",
        "scss", "html", "htm", "xml", "yml", "yaml", "toml", "ini", "conf", "log",
        "py", "rb", "go", "rs", "java", "kt", "c", "h", "cpp", "hpp", "cs", "php",
        "sh", "bat", "ps1", "sql", "csv", "tsv", "env", "gitignore", "license",
    };

    private static readonly string[] ArchiveSuffixes =
    {
        ".tar.gz", ".tar.bz2", ".tar.xz", ".tgz", ".tbz2", ".txz",
    };

    private static readonly string[] CreateExtensions =
    {
        ".zip", ".7z", ".tar", ".gz", ".tgz", ".bz2", ".tbz2", ".xz", ".txz",
    };

    private WebApplication? _app;

    public string BaseUrl { get; private set; } = "http://127.0.0.1:8790";

    public Func<string, Task>? ResizeWindow { get; set; }

    public Func<Task<string?>>? PickFolder { get; set; }

    public Func<Task<List<string>>>? PickFiles { get; set; }

    public async Task StartAsync()
    {
        var port = PickPort();
        BaseUrl = $"http://127.0.0.1:{port}";
        Directory.CreateDirectory(Store.TempRoot);

        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.Limits.MaxRequestBodySize = 600L * 1024 * 1024;
            options.Listen(IPAddress.Loopback, port);
        });
        builder.Services.ConfigureHttpJsonOptions(options =>
        {
            options.SerializerOptions.PropertyNamingPolicy = null;
            options.SerializerOptions.DictionaryKeyPolicy = null;
        });

        var app = builder.Build();
        _app = app;

        app.Use(async (context, next) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            await next();
        });

        var webRoot = Path.Combine(AppContext.BaseDirectory, "web");
        var provider = new PhysicalFileProvider(webRoot);
        app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = provider });
        app.UseStaticFiles(new StaticFileOptions { FileProvider = provider });

        MapRoutes(app);

        await app.StartAsync();
    }

    private void MapRoutes(WebApplication app)
    {
        app.MapGet("/api/health", () => Results.Json(new Dictionary<string, object?>
        {
            ["ok"] = File.Exists(SevenZip.ExePath),
            ["kernel"] = SevenZip.ExePath,
        }));

        app.MapGet("/api/gpu", () => Results.Json(DetectGpu()));

        app.MapGet("/api/about", () => Results.Json(new Dictionary<string, object?>
        {
            ["app"] = AppVersion,
            ["kernel"] = File.Exists(SevenZip.ExePath) ? SevenZip.ExePath : "未找到 7-Zip 内核",
            ["kernelVersion"] = SevenZip.KernelVersion(),
            ["webview"] = WebView2Version(),
            ["gpu"] = DetectGpu(),
            ["python"] = RuntimeInformation.FrameworkDescription,
        }));

        app.MapPost("/api/window/size", async (HttpContext context) =>
        {
            var request = await ReadJsonAsync<WindowSizeRequest>(context);
            var mode = string.Equals(request?.Mode, "mini", StringComparison.OrdinalIgnoreCase) ? "mini" : "max";
            if (ResizeWindow is null)
            {
                return Results.Json(new Dictionary<string, object?> { ["ok"] = false, ["reason"] = "no-window" });
            }
            await ResizeWindow(mode);
            return Results.Json(new Dictionary<string, object?> { ["ok"] = true, ["mode"] = mode });
        });

        app.MapPost("/api/open", async (HttpContext context) =>
        {
            var form = await context.Request.ReadFormAsync();
            var upload = form.Files.GetFile("file");
            if (upload is null || string.IsNullOrWhiteSpace(upload.FileName))
            {
                return Error("没有收到文件", 400);
            }

            var name = SafeBasename(upload.FileName);
            var id = Store.NewId();
            var folder = Path.Combine(Store.TempRoot, id);
            Directory.CreateDirectory(folder);
            var target = Path.Combine(folder, name);
            await using (var stream = File.Create(target))
            {
                await upload.CopyToAsync(stream);
            }

            var session = new ArchiveSession { Id = id, FilePath = target, Name = name, Dir = folder };
            Store.Sessions[id] = session;
            try
            {
                return Results.Json(Store.BuildPayload(session));
            }
            catch (Exception ex)
            {
                Store.Sessions.TryRemove(id, out _);
                TryDeleteDir(folder);
                return Error($"无法读取压缩包：{ex.Message}", 400);
            }
        });

        app.MapPost("/api/pick/files", async () =>
        {
            var files = PickFiles is null ? new List<string>() : await PickFiles();
            if (files.Count == 0)
            {
                return Results.Json(new Dictionary<string, object?> { ["cancelled"] = true });
            }
            var items = files.Select(path =>
            {
                long size;
                try { size = new FileInfo(path).Length; }
                catch { size = 0; }
                return new Dictionary<string, object?>
                {
                    ["path"] = path,
                    ["name"] = Path.GetFileName(path),
                    ["size"] = size,
                };
            }).ToList();
            return Results.Json(new Dictionary<string, object?> { ["files"] = items });
        });

        app.MapPost("/api/pick/folder", async () =>
        {
            var folder = PickFolder is null ? null : await PickFolder();
            if (string.IsNullOrEmpty(folder))
            {
                return Results.Json(new Dictionary<string, object?> { ["cancelled"] = true });
            }
            return Results.Json(new Dictionary<string, object?> { ["folder"] = folder });
        });

        app.MapPost("/api/create", async (HttpContext context) =>
        {
            var request = await ReadJsonAsync<CreateRequest>(context);
            var files = (request?.Files ?? new List<string>())
                .Where(item => !string.IsNullOrWhiteSpace(item) && File.Exists(item))
                .ToList();
            if (files.Count == 0)
            {
                return Error("请先选择要压缩的文件", 400);
            }

            var folder = (request?.Folder ?? "").Trim();
            if (folder.Length == 0)
            {
                return Error("请选择保存位置", 400);
            }

            var name = SafeBasename((request?.Name ?? "").Trim());
            if (name == "file")
            {
                name = "新建压缩包";
            }
            var extension = Path.GetExtension(name).ToLowerInvariant();
            if (!CreateExtensions.Contains(extension))
            {
                name += ".zip";
            }

            var target = Path.Combine(folder, name);
            if (File.Exists(target) || Directory.Exists(target))
            {
                return Error("同名文件已存在，请换一个名称", 409);
            }

            try
            {
                Directory.CreateDirectory(folder);
            }
            catch (Exception ex)
            {
                return Error($"无法创建目录：{ex.Message}", 500);
            }

            Store.PruneJobs();
            var job = new Job
            {
                Id = Store.NewId(),
                Kind = "create",
                Target = target,
                Name = name,
                Files = files.Count,
                Total = files.Count,
            };
            Store.Jobs[job.Id] = job;
            var jobId = job.Id;
            _ = Task.Run(() => CreateWorkerAsync(jobId, files, target));

            return Results.Json(new Dictionary<string, object?>
            {
                ["ok"] = true,
                ["jobId"] = jobId,
                ["target"] = target,
                ["name"] = name,
                ["total"] = files.Count,
            });
        });

        app.MapPost("/api/demo", async () =>
        {
            var demoDir = Path.Combine(Store.TempRoot, "demo");
            Directory.CreateDirectory(demoDir);
            var demoPath = Path.Combine(demoDir, "XiZip 演示包.zip");
            if (!File.Exists(demoPath))
            {
                await File.WriteAllBytesAsync(demoPath, BuildDemoZip());
            }
            var session = Store.NewSession(demoPath, Path.GetFileName(demoPath));
            return Results.Json(Store.BuildPayload(session));
        });

        app.MapGet("/api/archives/{sid}/info", (string sid) =>
        {
            if (!Store.Sessions.TryGetValue(sid, out var session))
            {
                return Error("压缩包会话已失效", 404);
            }
            try
            {
                return Results.Json(Store.BuildPayload(session));
            }
            catch (Exception ex)
            {
                return Error($"无法读取压缩包：{ex.Message}", 500);
            }
        });

        app.MapGet("/api/archives/{sid}/preview", (HttpContext context, string sid) =>
        {
            if (!Store.Sessions.TryGetValue(sid, out var session))
            {
                return Error("压缩包会话已失效", 404);
            }

            var entryPath = (context.Request.Query["path"].ToString() ?? "").Trim().Trim('/');
            if (entryPath.Length == 0)
            {
                return Error("缺少文件路径", 400);
            }

            var entry = SevenZip.List(session.FilePath).FirstOrDefault(item => item.Path == entryPath);
            if (entry is null)
            {
                return Error("文件不存在", 404);
            }
            if (entry.IsDir)
            {
                return Error("目录无法预览", 400);
            }
            if (entry.Size > 40L * 1024 * 1024)
            {
                return Error("文件超过 40 MB，暂不支持在线预览", 413);
            }

            byte[] data;
            var (code, bytes) = SevenZip.ExtractToMemory(session.FilePath, entryPath);
            if (code is not (0 or 1) || bytes.Length == 0)
            {
                // 个别文件名含通配符时回退为“解压到临时目录”
                var tmp = Path.Combine(session.Dir, "preview_" + Guid.NewGuid().ToString("N")[..8]);
                try
                {
                    Directory.CreateDirectory(tmp);
                    SevenZip.Run(
                        new[] { "x", "-o" + tmp, "-y", "-bd", session.FilePath, entryPath },
                        null, 120_000);
                    var candidate = Path.Combine(tmp, entryPath.Replace('/', Path.DirectorySeparatorChar));
                    if (!File.Exists(candidate))
                    {
                        candidate = Directory.EnumerateFiles(tmp, "*", SearchOption.AllDirectories)
                            .FirstOrDefault(file =>
                                Path.GetRelativePath(tmp, file).Replace('\\', '/') == entryPath) ?? candidate;
                    }
                    if (!File.Exists(candidate))
                    {
                        return Error("无法读取该文件内容", 500);
                    }
                    data = File.ReadAllBytes(candidate);
                }
                finally
                {
                    TryDeleteDir(tmp);
                }
            }
            else
            {
                data = bytes;
            }

            context.Response.Headers["X-XiZip-Size"] = data.Length.ToString();
            return Results.File(data, MimeFor(entry.Ext));
        });

        app.MapPost("/api/archives/{sid}/extract", async (HttpContext context, string sid) =>
        {
            if (!Store.Sessions.TryGetValue(sid, out var session))
            {
                return Error("压缩包会话已失效", 404);
            }

            var request = await ReadJsonAsync<ExtractRequest>(context);
            var paths = (request?.Paths ?? new List<string>())
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .Select(item => item.Trim())
                .ToList();
            var target = (request?.Target ?? "").Trim();

            if (target.Length == 0)
            {
                var picked = PickFolder is null ? null : await PickFolder();
                if (string.IsNullOrEmpty(picked))
                {
                    return Results.Json(new Dictionary<string, object?>
                    {
                        ["ok"] = false,
                        ["reason"] = "cancelled",
                    });
                }
                target = picked;
            }

            var targetPath = Path.Combine(target, ExtractFolderName(session.FilePath));
            try
            {
                Directory.CreateDirectory(targetPath);
            }
            catch (Exception ex)
            {
                return Error($"无法创建目录：{ex.Message}", 500);
            }

            int total;
            long totalBytes;
            try
            {
                (total, totalBytes) = ExtractScopeStats(session.FilePath, paths);
            }
            catch
            {
                total = 0;
                totalBytes = 0;
            }

            Store.PruneJobs();
            var job = new Job
            {
                Id = Store.NewId(),
                Kind = "extract",
                Target = targetPath,
                Total = total,
                Bytes = totalBytes,
            };
            Store.Jobs[job.Id] = job;
            var jobId = job.Id;
            _ = Task.Run(() => ExtractWorkerAsync(jobId, session.FilePath, paths, targetPath, totalBytes));

            return Results.Json(new Dictionary<string, object?>
            {
                ["ok"] = true,
                ["jobId"] = jobId,
                ["target"] = targetPath,
                ["total"] = total,
            });
        });

        app.MapGet("/api/jobs/{jobId}", (string jobId) =>
        {
            if (!Store.Jobs.TryGetValue(jobId, out var job))
            {
                return Error("任务不存在", 404);
            }
            Store.PruneJobs();
            return Results.Json(Store.Snapshot(job));
        });

        app.MapPost("/api/jobs/{jobId}/cancel", (string jobId) =>
        {
            if (!Store.Jobs.TryGetValue(jobId, out var job))
            {
                return Error("任务不存在", 404);
            }

            lock (Store.Sync)
            {
                if (job.State != "running")
                {
                    return Results.Json(new Dictionary<string, object?>
                    {
                        ["ok"] = false,
                        ["state"] = job.State,
                    });
                }
                Store.Cancelled.Add(jobId);
                if (Store.Processes.TryGetValue(jobId, out var process))
                {
                    try
                    {
                        if (!process.HasExited)
                        {
                            process.Kill();
                        }
                    }
                    catch
                    {
                        /* 进程可能已经退出 */
                    }
                }
            }

            return Results.Json(new Dictionary<string, object?>
            {
                ["ok"] = true,
                ["state"] = "cancelling",
            });
        });

        app.MapPost("/api/archives/{sid}/add", async (HttpContext context, string sid) =>
        {
            if (!Store.Sessions.TryGetValue(sid, out var session))
            {
                return Error("压缩包会话已失效", 404);
            }

            var form = await context.Request.ReadFormAsync();
            var uploads = form.Files.GetFiles("files");
            if (uploads.Count == 0)
            {
                return Error("没有收到文件", 400);
            }

            var folder = (form["folder"].ToString() ?? "").Trim().Trim('/');
            if (folder.StartsWith('/') || folder.Split('/').Any(part => part == ".."))
            {
                folder = "";
            }

            var staging = Path.Combine(session.Dir, "add_" + Guid.NewGuid().ToString("N")[..8]);
            Directory.CreateDirectory(staging);
            var relNames = new List<string>();
            try
            {
                foreach (var upload in uploads)
                {
                    if (string.IsNullOrWhiteSpace(upload.FileName))
                    {
                        continue;
                    }
                    var name = SafeBasename(upload.FileName);
                    var rel = folder.Length > 0 ? $"{folder}/{name}" : name;
                    var dest = Path.Combine(staging, rel.Replace('/', Path.DirectorySeparatorChar));
                    Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                    await using (var stream = File.Create(dest))
                    {
                        await upload.CopyToAsync(stream);
                    }
                    relNames.Add(rel);
                }

                if (relNames.Count == 0)
                {
                    return Error("没有有效的文件", 400);
                }

                var args = new List<string> { "a", "-y", "-bd", session.FilePath };
                args.AddRange(relNames);
                var result = SevenZip.Run(args, staging, 600_000);
                if (result.ExitCode is not (0 or 1))
                {
                    return Error(result.StdOut + result.StdErr, 500);
                }
            }
            finally
            {
                TryDeleteDir(staging);
            }

            var payload = Store.BuildPayload(session);
            payload["added"] = relNames.Count;
            payload["addedPaths"] = relNames;
            return Results.Json(payload);
        });

        app.MapPost("/api/archives/{sid}/delete", async (HttpContext context, string sid) =>
        {
            if (!Store.Sessions.TryGetValue(sid, out var session))
            {
                return Error("压缩包会话已失效", 404);
            }

            var request = await ReadJsonAsync<DeleteRequest>(context);
            var paths = (request?.Paths ?? new List<string>())
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .ToList();
            if (paths.Count == 0)
            {
                return Error("没有选择要删除的项目", 400);
            }

            var args = new List<string> { "d", "-y", "-bd", "-sccUTF-8", session.FilePath };
            args.AddRange(paths);
            var result = SevenZip.Run(args, null, 600_000);
            if (result.ExitCode is not (0 or 1))
            {
                return Error(result.StdOut + result.StdErr, 500);
            }

            var payload = Store.BuildPayload(session);
            payload["ok"] = true;
            payload["deleted"] = paths.Count;
            return Results.Json(payload);
        });
    }

    // ----------------------------------------------------------------------- //
    // 解压 / 新建任务
    // ----------------------------------------------------------------------- //

    private static async Task ExtractWorkerAsync(
        string jobId, string archive, List<string> paths, string target, long totalBytes)
    {
        var job = Store.Jobs[jobId];
        var baseline = Store.FolderBytes(target);
        if (baseline < 0)
        {
            totalBytes = 0;
        }

        using var stop = new CancellationTokenSource();
        Task? watcher = null;
        if (totalBytes > 0)
        {
            watcher = Task.Run(async () =>
            {
                try
                {
                    while (!stop.IsCancellationRequested)
                    {
                        await Task.Delay(220, stop.Token);
                        var size = Store.FolderBytes(target);
                        if (size < 0 || totalBytes <= 0)
                        {
                            return;
                        }
                        var grown = size - Math.Max(0, baseline);
                        if (grown <= 0)
                        {
                            continue;
                        }
                        var percent = (int)Math.Min(99, grown * 100 / totalBytes);
                        lock (Store.Sync)
                        {
                            if (percent > job.Percent)
                            {
                                job.Percent = percent;
                            }
                        }
                    }
                }
                catch (OperationCanceledException)
                {
                    /* 正常结束 */
                }
                catch
                {
                    /* 估算失败不影响解压 */
                }
            });
        }

        Process? process = null;
        try
        {
            var args = new List<string> { "x", archive, "-o" + target, "-y", "-aos", "-bsp1" };
            args.AddRange(paths);
            var info = SevenZip.StartInfo(args);
            info.RedirectStandardError = true;
            process = Process.Start(info) ?? throw new InvalidOperationException("无法启动 7-Zip");

            var stderr = process.StandardError.ReadToEndAsync();
            var buffer = new StringBuilder();
            var chunk = new byte[1024];
            int read;
            while ((read = await process.StandardOutput.BaseStream.ReadAsync(chunk)) > 0)
            {
                buffer.Append(Encoding.UTF8.GetString(chunk, 0, read));
                var pieces = Regex.Split(buffer.ToString(), "[\r\n]+");
                buffer.Clear().Append(pieces[^1]);
                for (var index = 0; index < pieces.Length - 1; index++)
                {
                    ApplyProgressLine(job, pieces[index]);
                }
            }
            if (buffer.Length > 0)
            {
                ApplyProgressLine(job, buffer.ToString());
            }
            await process.WaitForExitAsync();
            _ = stderr;

            var code = process.ExitCode;
            var ok = code is 0 or 1;
            lock (Store.Sync)
            {
                job.State = ok ? "done" : "error";
                if (ok)
                {
                    job.Percent = 100;
                }
                else
                {
                    job.Error = $"7-Zip 返回码 {code}";
                }
                job.Finished = Job.Now();
            }
        }
        catch (Exception ex)
        {
            lock (Store.Sync)
            {
                job.State = "error";
                job.Error = $"无法启动 7-Zip：{ex.Message}";
                job.Finished = Job.Now();
            }
        }
        finally
        {
            stop.Cancel();
            if (watcher is not null)
            {
                try { await watcher; } catch { /* ignore */ }
            }
            process?.Dispose();
        }
    }

    private static async Task CreateWorkerAsync(string jobId, List<string> files, string target)
    {
        var job = Store.Jobs[jobId];
        Process? process = null;
        var detail = "";

        try
        {
            var args = new List<string> { "a", "-y", "-sccUTF-8", "-bsp1", target };
            args.AddRange(files);
            var info = SevenZip.StartInfo(args);
            info.RedirectStandardError = true;
            process = Process.Start(info) ?? throw new InvalidOperationException("无法启动 7-Zip");
            Store.Processes[jobId] = process;

            var stderr = process.StandardError.ReadToEndAsync();
            var buffer = new StringBuilder();
            var chunk = new byte[1024];
            int read;
            while ((read = await process.StandardOutput.BaseStream.ReadAsync(chunk)) > 0)
            {
                buffer.Append(Encoding.UTF8.GetString(chunk, 0, read));
                var pieces = Regex.Split(buffer.ToString(), "[\r\n]+");
                buffer.Clear().Append(pieces[^1]);
                for (var index = 0; index < pieces.Length - 1; index++)
                {
                    ApplyProgressLine(job, pieces[index]);
                    if (pieces[index].Contains("ERROR", StringComparison.Ordinal)
                        || pieces[index].Contains("Can not open", StringComparison.Ordinal))
                    {
                        detail = pieces[index].Trim();
                    }
                }
            }
            await process.WaitForExitAsync();
            _ = stderr;
        }
        catch (Exception ex)
        {
            detail = ex.Message;
        }
        finally
        {
            Store.Processes.TryRemove(jobId, out _);
        }

        var code = 1;
        try { code = process?.ExitCode ?? 1; } catch { /* ignore */ }

        string result;
        lock (Store.Sync)
        {
            var cancelled = Store.Cancelled.Remove(jobId);
            if (cancelled)
            {
                job.State = "cancelled";
                job.Error = "";
                job.Finished = Job.Now();
            }
            else if (code is 0 or 1)
            {
                job.State = "done";
                job.Percent = 100;
                job.Finished = Job.Now();
            }
            else
            {
                job.State = "error";
                job.Error = detail.Length > 0 ? detail : $"7-Zip 返回码 {code}";
                job.Finished = Job.Now();
            }
            result = job.State;
        }

        process?.Dispose();

        if (result != "done")
        {
            TryDeleteFile(target);
            return;
        }

        try
        {
            var session = Store.NewSession(target, Path.GetFileName(target));
            lock (Store.Sync)
            {
                job.Sid = session.Id;
            }
        }
        catch (Exception ex)
        {
            lock (Store.Sync)
            {
                job.State = "error";
                job.Error = $"无法读取压缩包：{ex.Message}";
                job.Finished = Job.Now();
            }
            TryDeleteFile(target);
        }
    }

    /// <summary>解析 7-Zip 的 ` 42% 7 - name` 进度行。</summary>
    private static void ApplyProgressLine(Job job, string line)
    {
        var match = ProgressRegex.Match(line);
        if (!match.Success)
        {
            return;
        }

        var percent = Math.Min(100, int.Parse(match.Groups[1].Value));
        lock (Store.Sync)
        {
            if (percent > job.Percent)
            {
                job.Percent = percent;
            }
            var index = line.IndexOf(" - ", StringComparison.Ordinal);
            if (index >= 0)
            {
                var name = line[(index + 3)..].Trim();
                if (name.Length > 0)
                {
                    job.Current = name;
                }
            }
        }
    }

    private static (int Files, long Bytes) ExtractScopeStats(string archive, List<string> paths)
    {
        var files = 0;
        long bytes = 0;
        foreach (var entry in SevenZip.List(archive))
        {
            if (entry.IsDir)
            {
                continue;
            }
            if (paths.Count > 0 && !paths.Any(path =>
                    entry.Path == path || entry.Path.StartsWith(path + "/", StringComparison.Ordinal)))
            {
                continue;
            }
            files += 1;
            bytes += entry.Size;
        }
        return (files, bytes);
    }

    // ----------------------------------------------------------------------- //
    // 系统信息
    // ----------------------------------------------------------------------- //

    private static Dictionary<string, object?>? _gpuInfo;

    private static Dictionary<string, object?> DetectGpu()
    {
        if (_gpuInfo is not null)
        {
            return _gpuInfo;
        }

        var name = "";
        try
        {
            var device = new DisplayDevice { cb = (uint)Marshal.SizeOf<DisplayDevice>() };
            if (EnumDisplayDevicesW(null, 0, ref device, 0))
            {
                name = (device.DeviceString ?? "").Trim();
            }
        }
        catch
        {
            name = "";
        }

        var lowered = name.ToLowerInvariant();
        var vendor = lowered.Contains("nvidia") ? "NVIDIA"
            : lowered.Contains("amd") || lowered.Contains("radeon") ? "AMD"
            : lowered.Contains("intel") ? "Intel"
            : "";

        _gpuInfo = new Dictionary<string, object?>
        {
            ["name"] = name,
            ["vendor"] = vendor,
            ["accelerated"] = name.Length > 0 && !lowered.Contains("basic"),
        };
        return _gpuInfo;
    }

    private static string WebView2Version()
    {
        var candidates = new List<string>();
        foreach (var variable in new[] { "ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA" })
        {
            var basePath = Environment.GetEnvironmentVariable(variable);
            if (string.IsNullOrEmpty(basePath))
            {
                continue;
            }
            var root = Path.Combine(basePath, "Microsoft", "EdgeWebView", "Application");
            if (!Directory.Exists(root))
            {
                continue;
            }
            foreach (var child in Directory.GetDirectories(root))
            {
                var name = Path.GetFileName(child);
                if (Regex.IsMatch(name, @"^\d+(\.\d+){2,3}$"))
                {
                    candidates.Add(name);
                }
            }
        }

        if (candidates.Count == 0)
        {
            return "未检测到";
        }
        return candidates.OrderBy(Version.Parse).Last();
    }

    // ----------------------------------------------------------------------- //
    // 工具
    // ----------------------------------------------------------------------- //

    private static int PickPort()
    {
        for (var port = 8790; port < 8810; port++)
        {
            try
            {
                using var listener = new TcpListener(IPAddress.Loopback, port);
                listener.Start();
                listener.Stop();
                return port;
            }
            catch
            {
                /* 端口被占用，继续探测 */
            }
        }
        return 8790;
    }

    private static async Task<T?> ReadJsonAsync<T>(HttpContext context) where T : class
    {
        try
        {
            return await context.Request.ReadFromJsonAsync<T>(ReadOptions);
        }
        catch
        {
            return null;
        }
    }

    private static IResult Error(string message, int status) =>
        Results.Json(new Dictionary<string, object?> { ["error"] = message }, statusCode: status);

    private static string SafeBasename(string filename)
    {
        var unified = filename.Replace('\\', '/');
        var index = unified.LastIndexOf('/');
        var name = index >= 0 ? unified[(index + 1)..] : unified;
        var builder = new StringBuilder(name.Length);
        foreach (var ch in name)
        {
            builder.Append(ch < 32 || "<>:\"|?*".Contains(ch) ? '_' : ch);
        }
        var cleaned = builder.ToString().Trim().TrimEnd('.');
        return cleaned.Length > 0 ? cleaned : "file";
    }

    /// <summary>解压时使用的子文件夹名：压缩包文件名去掉后缀。</summary>
    private static string ExtractFolderName(string archivePath)
    {
        var name = Path.GetFileName(archivePath);
        var lower = name.ToLowerInvariant();
        foreach (var suffix in ArchiveSuffixes)
        {
            if (lower.EndsWith(suffix, StringComparison.Ordinal))
            {
                return name[..^suffix.Length];
            }
        }
        var stem = Path.GetFileNameWithoutExtension(name);
        return stem.Length > 0 ? stem : name;
    }

    private static string MimeFor(string ext)
    {
        ext = (ext ?? "").ToLowerInvariant();
        if (ext == "svg")
        {
            return "image/svg+xml";
        }
        if (TextExts.Contains(ext))
        {
            return "text/plain; charset=utf-8";
        }
        return ext switch
        {
            "png" => "image/png",
            "jpg" or "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "bmp" => "image/bmp",
            "ico" => "image/x-icon",
            "avif" => "image/avif",
            "pdf" => "application/pdf",
            "mp3" => "audio/mpeg",
            "wav" => "audio/wav",
            "ogg" => "audio/ogg",
            "flac" => "audio/flac",
            "m4a" => "audio/mp4",
            "aac" => "audio/aac",
            "mp4" => "video/mp4",
            "webm" => "video/webm",
            "mov" => "video/quicktime",
            "mkv" => "video/x-matroska",
            "avi" => "video/x-msvideo",
            "zip" => "application/zip",
            _ => "application/octet-stream",
        };
    }

    private static void TryDeleteDir(string path)
    {
        try
        {
            if (Directory.Exists(path))
            {
                Directory.Delete(path, true);
            }
        }
        catch
        {
            /* ignore */
        }
    }

    private static void TryDeleteFile(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch
        {
            /* ignore */
        }
    }

    // ----------------------------------------------------------------------- //
    // 演示压缩包
    // ----------------------------------------------------------------------- //

    private static byte[] BuildDemoZip()
    {
        var files = new (string Path, string Text)[]
        {
            ("README.txt",
                "XiZip 演示压缩包\n" +
                "================\n\n" +
                "这个压缩包由 XiZip 在本地即时生成，用于体验界面。\n" +
                "双击右侧文件可在预览板块中查看内容。\n" +
                "把任意文件拖入文件窗格，即可追加进压缩包。\n"),
            ("LICENSE.txt", "MIT License\n\nCopyright (c) 2026 XiZip"),
            ("docs/使用说明.md",
                "# XiZip 使用说明\n\n" +
                "## 快捷键\n\n" +
                "- 拖拽压缩包到舞台：打开\n" +
                "- 拖拽普通文件到文件窗格：添加到压缩包\n\n" +
                "## 三种视图\n\n" +
                "| 视图 | 用途 |\n| --- | --- |\n" +
                "| MINI | 快速浏览与解压 |\n" +
                "| MAX | 文件树 + 列表 + 预览 |\n" +
                "| 预览 | 不解压直接查看 |\n"),
            ("data/清单.csv",
                "名称,类型,压缩后,压缩率\n" +
                "封面.svg,图像,148 KB,62%\n" +
                "banner.svg,图像,96 KB,58%\n" +
                "使用说明.md,文档,2 KB,41%\n" +
                "main.py,代码,3 KB,49%\n"),
            ("src/main.py",
                "from pathlib import Path\n\n\n" +
                "def scan(folder: Path):\n" +
                "    for item in sorted(folder.iterdir()):\n" +
                "        yield item.name, item.stat().st_size\n\n\n" +
                "if __name__ == \"__main__\":\n" +
                "    print(list(scan(Path(\".\"))))\n"),
            ("src/utils.py",
                "def human_size(num: int) -> str:\n" +
                "    for unit in ('B', 'KB', 'MB', 'GB'):\n" +
                "        if num < 1024:\n" +
                "            return f'{num:.1f} {unit}'\n" +
                "        num /= 1024\n" +
                "    return f'{num:.1f} TB'\n"),
            ("assets/封面.svg", SvgCover),
            ("assets/banner.svg", SvgBanner),
            ("assets/logo.svg", SvgLogo),
        };

        using var buffer = new MemoryStream();
        using (var archive = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var (path, text) in files)
            {
                var entry = archive.CreateEntry(path, CompressionLevel.Optimal);
                using var stream = entry.Open();
                var data = Encoding.UTF8.GetBytes(text);
                stream.Write(data, 0, data.Length);
            }
        }
        return buffer.ToArray();
    }

    private const string SvgCover = """
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#17110b"/>
      <stop offset="1" stop-color="#2a1c0c"/>
    </linearGradient>
    <radialGradient id="violet" cx="0.28" cy="0.18" r="0.75">
      <stop offset="0" stop-color="#e8a33a" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#e8a33a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="pink" cx="0.82" cy="0.78" r="0.7">
      <stop offset="0" stop-color="#f4704f" stop-opacity="0.75"/>
      <stop offset="1" stop-color="#f4704f" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="teal" cx="0.66" cy="0.22" r="0.55">
      <stop offset="0" stop-color="#ffbe6c" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#ffbe6c" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="type" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.7" stop-color="#ffe1b4"/>
      <stop offset="1" stop-color="#e6a33c"/>
    </linearGradient>
  </defs>
  <rect width="960" height="600" fill="url(#bg)"/>
  <rect width="960" height="600" fill="url(#violet)"/>
  <rect width="960" height="600" fill="url(#pink)"/>
  <rect width="960" height="600" fill="url(#teal)"/>
  <g opacity="0.16">
    <circle cx="120" cy="510" r="140" fill="none" stroke="#ffffff" stroke-width="1"/>
    <circle cx="120" cy="510" r="220" fill="none" stroke="#ffffff" stroke-width="1"/>
    <circle cx="840" cy="90" r="120" fill="none" stroke="#ffffff" stroke-width="1"/>
  </g>
  <g>
    <rect x="72" y="72" width="44" height="44" rx="12" fill="#d98a1c" opacity="0.9"/>
    <path d="M86 86h24v5H86zM86 96h24v2H86zM86 102h18v2H86zM86 108h24v2H86z" fill="#ffffff" opacity="0.85"/>
    <text x="132" y="104" font-family="Segoe UI, sans-serif" font-size="24" letter-spacing="4" fill="#f3d6a6">XIZIP STUDIO</text>
  </g>
  <text x="72" y="320" font-family="Segoe UI, sans-serif" font-size="132" font-weight="700" letter-spacing="-3" fill="url(#type)">XiZip</text>
  <text x="76" y="382" font-family="Segoe UI, sans-serif" font-size="26" letter-spacing="2" fill="#c2ad8d">COMPRESS · INSPECT · EXTRACT</text>
  <g opacity="0.55">
    <rect x="76" y="440" width="140" height="3" rx="1.5" fill="#d98a1c"/>
    <text x="76" y="490" font-family="Segoe UI, sans-serif" font-size="16" fill="#9a8768">7-Zip kernel · local first · zero cloud</text>
  </g>
</svg>
""";

    private const string SvgBanner = """
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="420" viewBox="0 0 1200 420">
  <defs>
    <linearGradient id="b1" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#b5660e"/>
      <stop offset="0.5" stop-color="#e8a33a"/>
      <stop offset="1" stop-color="#ffbe6c"/>
    </linearGradient>
    <linearGradient id="b2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#17110b"/>
      <stop offset="1" stop-color="#241708"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="420" fill="url(#b2)"/>
  <g transform="translate(0,-40)">
    <ellipse cx="980" cy="230" rx="360" ry="240" fill="url(#b1)" opacity="0.35"/>
    <ellipse cx="260" cy="160" rx="300" ry="200" fill="#f4704f" opacity="0.12"/>
  </g>
  <g font-family="Segoe UI, sans-serif">
    <text x="80" y="200" font-size="64" font-weight="700" fill="#fff6e8">解压，从未如此安静。</text>
    <text x="84" y="256" font-size="22" fill="#c2ad8d" letter-spacing="1">XiZip 以 7-Zip 为内核，界面只有玻璃、光与文件。</text>
    <rect x="84" y="300" width="188" height="52" rx="26" fill="#ffffff" opacity="0.1"/>
    <text x="118" y="333" font-size="18" fill="#ffe6c2">XiZip MAX →</text>
  </g>
</svg>
""";

    private const string SvgLogo = """
<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
  <defs>
    <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffd08a"/>
      <stop offset="0.55" stop-color="#e8a33a"/>
      <stop offset="1" stop-color="#8a4c06"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="144" height="144" rx="36" fill="url(#lg)"/>
  <rect x="8" y="8" width="144" height="144" rx="36" fill="none" stroke="#ffffff" stroke-opacity="0.28" stroke-width="2"/>
  <g fill="#ffffff" fill-opacity="0.92">
    <path d="M50 56h60v8H50z"/>
    <path d="M50 72h60v4H50z"/>
    <path d="M50 84h44v4H50z"/>
    <path d="M50 96h60v4H50z"/>
    <path d="M50 108h32v4H50z"/>
  </g>
  <circle cx="112" cy="110" r="18" fill="#ffffff" fill-opacity="0.16"/>
  <path d="M112 102v16M104 110h16" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>
</svg>
""";

    // ----------------------------------------------------------------------- //
    // P/Invoke
    // ----------------------------------------------------------------------- //

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DisplayDevice
    {
        public uint cb;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string DeviceName;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceString;

        public uint StateFlags;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceID;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceKey;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool EnumDisplayDevicesW(string? device, uint devNum, ref DisplayDevice info, uint flags);

    private sealed record CreateRequest(List<string>? Files, string? Folder, string? Name);

    private sealed record ExtractRequest(List<string>? Paths, string? Target);

    private sealed record DeleteRequest(List<string>? Paths);

    private sealed record WindowSizeRequest(string? Mode);

    public void Dispose()
    {
        var app = _app;
        _app = null;
        if (app is null)
        {
            return;
        }
        try
        {
            app.StopAsync(CancellationToken.None).Wait(TimeSpan.FromSeconds(3));
        }
        catch
        {
            /* ignore */
        }
        try
        {
            app.DisposeAsync().AsTask().GetAwaiter().GetResult();
        }
        catch
        {
            /* ignore */
        }
    }
}
