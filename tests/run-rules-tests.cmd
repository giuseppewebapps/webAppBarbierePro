@echo off
REM Test delle regole Firestore sull Emulator (richiede Java 21+).
REM Uso: tests\run-rules-tests.cmd   (puoi forzare il runtime con JRE21=percorso)
setlocal
if not defined JRE21 set "JRE21=%USERPROFILE%\tools\temurin-jre21\jdk-21.0.12.1+1-jre"
if exist "%JRE21%\bin\java.exe" (
  set "JAVA_HOME=%JRE21%"
) else (
  echo ATTENZIONE: JRE 21 non trovato in %JRE21%
)
if defined JAVA_HOME set "PATH=%JAVA_HOME%\bin;%PATH%"
cd /d "%~dp0.."
echo Target: %CD%
echo Java:   %JAVA_HOME%
npx -y firebase-tools emulators:exec --only firestore --project demo-hardening "node --test tests/rules/*.test.mjs"
endlocal