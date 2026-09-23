; Step 3 reliability hardening — uninstall-time cleanup only.
;
; The "HumanCare Connect Monitoring Agent" Scheduled Task (per-user logon
; trigger + bounded crash-restart) is registered at RUNTIME by the Agent
; itself, only after a successful enrollment (see src/autostart.js). It is
; deliberately NOT created here at install time, so a fresh install never
; gets an auto-starting/relaunching task before the employee has entered
; enrollment credentials.
;
; It IS removed here at uninstall time, because the running Agent may not
; get a chance to remove it itself (e.g. an uninstall run without first using
; "Exit Agent" / reconfigure). Deleting a task that doesn't exist just fails
; harmlessly — always safe to run unconditionally.
;
; No admin privileges are required: this is the same per-user task the Agent
; itself creates (RunLevel LeastPrivilege), so a per-user schtasks /Delete
; needs none either.

!macro customUnInstall
  DetailPrint "Removing scheduled task: HumanCare Connect Monitoring Agent (if present)..."
  ExecWait 'schtasks.exe /Delete /TN "HumanCare Connect Monitoring Agent" /F' $0
!macroend
