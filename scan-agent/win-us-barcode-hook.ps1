# US-QWERTY barcode hook — layout-independent (works with Arabic keyboard active).
# Prints one line per completed scan: SCAN:<code>
# Node reads stdout.

$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

public sealed class UsBarcodeHook {
  private const int WH_KEYBOARD_LL = 13;
  private const int WM_KEYDOWN = 0x0100;
  private const int WM_SYSKEYDOWN = 0x0104;
  private const int VK_RETURN = 0x0D;
  private const int MAX_GAP_MS = 140;

  private static IntPtr _hook = IntPtr.Zero;
  private static LowLevelKeyboardProc _proc = HookProc;
  private static readonly StringBuilder Buf = new StringBuilder(64);
  private static long _lastMs = 0;

  private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

  [DllImport("user32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool UnhookWindowsHookEx(IntPtr hhk);

  [DllImport("user32.dll")]
  private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

  [DllImport("kernel32.dll")]
  private static extern IntPtr GetModuleHandle(string lpModuleName);

  [StructLayout(LayoutKind.Sequential)]
  private struct KBDLLHOOKSTRUCT {
    public uint vkCode;
    public uint scanCode;
    public uint flags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  // Physical VK → US barcode character (ignore active keyboard layout)
  private static char FromVk(uint vk) {
    if (vk >= 0x30 && vk <= 0x39) return (char)vk;           // 0-9
    if (vk >= 0x41 && vk <= 0x5A) return (char)vk;           // A-Z
    if (vk >= 0x60 && vk <= 0x69) return (char)('0' + (vk - 0x60)); // numpad
    if (vk == 0xBD || vk == 0x6D) return '-';                // minus
    if (vk == 0xBE) return '.';
    return '\0';
  }

  private static IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN)) {
      var info = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
      long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
      if (_lastMs > 0 && now - _lastMs > MAX_GAP_MS) Buf.Clear();
      _lastMs = now;

      if (info.vkCode == VK_RETURN) {
        if (Buf.Length >= 6) {
          Console.WriteLine("SCAN:" + Buf.ToString());
          Console.Out.Flush();
        }
        Buf.Clear();
      } else {
        char ch = FromVk(info.vkCode);
        if (ch != '\0') Buf.Append(ch);
      }
    }
    return CallNextHookEx(_hook, nCode, wParam, lParam);
  }

  public static void Run() {
    using (Process cur = Process.GetCurrentProcess())
    using (ProcessModule mod = cur.MainModule) {
      _hook = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(mod.ModuleName), 0);
      if (_hook == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      Console.WriteLine("HOOK_READY");
      Console.Out.Flush();
      Application.Run();
    }
  }
}
"@ -ReferencedAssemblies System.Windows.Forms

[UsBarcodeHook]::Run()
