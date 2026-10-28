' tv-brightness-switcher.vbs - windowless launcher
' Launches the PowerShell resident script with a hidden window.
' Called by Task Scheduler: wscript.exe "path\to\this.vbs"
'
' IMPORTANT: the 3rd arg of Run() MUST be True (wait).
' If False, wscript exits immediately, Task Scheduler marks the task
' "finished" and kills the whole child process tree, so the resident
' PowerShell process would be terminated. With True, wscript stays
' running (windowless) and the task stays in Running state.
Option Explicit

Dim shell, scriptPath
Set shell = CreateObject("WScript.Shell")

' main .ps1 lives in the same directory as this .vbs:
' GetParentFolderName(ScriptFullName) returns the .vbs folder.
scriptPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
scriptPath = shell.ExpandEnvironmentStrings(scriptPath) & "\tv-brightness-switcher.ps1"

' arg1 = 0 (hidden window); arg3 = True (wait for powershell to exit)
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptPath & """", 0, True
