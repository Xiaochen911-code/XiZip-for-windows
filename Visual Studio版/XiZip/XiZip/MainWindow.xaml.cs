using System.IO;
using System.Windows;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;
using XiZip.Services;

namespace XiZip;

public partial class MainWindow : Window
{
    private readonly ApiServer _server;

    public MainWindow(ApiServer server)
    {
        InitializeComponent();
        _server = server;
        Browser.DefaultBackgroundColor = System.Drawing.Color.FromArgb(10, 7, 4);

        _server.ResizeWindow = mode =>
        {
            Dispatcher.Invoke(() => ApplyMode(mode));
            return Task.CompletedTask;
        };
        _server.PickFolder = () => Dispatcher.InvokeAsync(SelectFolder).Task;
        _server.PickFiles = () => Dispatcher.InvokeAsync(SelectFiles).Task;

        ApplyMode("max");
    }

    public async Task InitializeWebViewAsync()
    {
        var dataFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "XiZip");
        Directory.CreateDirectory(dataFolder);

        var options = new CoreWebView2EnvironmentOptions
        {
            // 让 WebView2 走 GPU 合成：光栅化、零拷贝与画布外置渲染
            AdditionalBrowserArguments =
                "--enable-gpu-rasterization --enable-zero-copy --ignore-gpu-blocklist " +
                "--enable-features=CanvasOopRasterization",
        };

        var environment = await CoreWebView2Environment.CreateAsync(null, dataFolder, options);
        await Browser.EnsureCoreWebView2Async(environment);

        Browser.AllowExternalDrop = true;

        var settings = Browser.CoreWebView2.Settings;
        settings.AreDefaultContextMenusEnabled = false;
        settings.AreDevToolsEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.IsZoomControlEnabled = false;
        settings.AreBrowserAcceleratorKeysEnabled = false;

        Browser.CoreWebView2.Navigate(_server.BaseUrl);
    }

    /// <summary>MINI 用小窗口，MAX 用大窗口，切换视图时同步调整窗口尺寸。</summary>
    private void ApplyMode(string mode)
    {
        var area = SystemParameters.WorkArea;
        double width;
        double height;

        if (string.Equals(mode, "mini", StringComparison.OrdinalIgnoreCase))
        {
            width = 940;
            height = 660;
        }
        else
        {
            width = Math.Min(1440, Math.Max(1080, area.Width * 0.88));
            height = Math.Min(960, Math.Max(680, area.Height * 0.86));
        }

        width = Math.Min(width, area.Width);
        height = Math.Min(height, area.Height);

        if (WindowState != WindowState.Normal)
        {
            WindowState = WindowState.Normal;
        }

        Width = width;
        Height = height;
        Left = area.Left + Math.Max(0, (area.Width - width) / 2);
        Top = area.Top + Math.Max(0, (area.Height - height) / 2);
    }

    private string? SelectFolder()
    {
        using var dialog = new System.Windows.Forms.FolderBrowserDialog
        {
            Description = "选择解压目录",
            UseDescriptionForTitle = true,
            ShowNewFolderButton = true,
        };
        var owner = new WindowHandle(new WindowInteropHelper(this).Handle);
        return dialog.ShowDialog(owner) == System.Windows.Forms.DialogResult.OK ? dialog.SelectedPath : null;
    }

    private List<string> SelectFiles()
    {
        using var dialog = new System.Windows.Forms.OpenFileDialog
        {
            Title = "选择要压缩的文件",
            Multiselect = true,
            CheckFileExists = true,
        };
        var owner = new WindowHandle(new WindowInteropHelper(this).Handle);
        return dialog.ShowDialog(owner) == System.Windows.Forms.DialogResult.OK
            ? dialog.FileNames.ToList()
            : new List<string>();
    }

    private sealed class WindowHandle : System.Windows.Forms.IWin32Window
    {
        public WindowHandle(IntPtr handle) => Handle = handle;

        public IntPtr Handle { get; }
    }
}
