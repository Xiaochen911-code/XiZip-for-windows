using System.Windows;
using XiZip.Services;

namespace XiZip;

public partial class App : System.Windows.Application
{
    private ApiServer? _server;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        _server = new ApiServer();
        try
        {
            await _server.StartAsync();
        }
        catch (Exception ex)
        {
            System.Windows.MessageBox.Show($"本地服务启动失败：{ex.Message}", "XiZip", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
            return;
        }

        var window = new MainWindow(_server);
        MainWindow = window;
        window.Show();

        try
        {
            await window.InitializeWebViewAsync();
        }
        catch (Exception ex)
        {
            System.Windows.MessageBox.Show($"界面加载失败：{ex.Message}", "XiZip", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _server?.Dispose();
        Store.Cleanup();
        base.OnExit(e);
    }
}
