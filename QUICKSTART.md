# VoltIQ quick start

Use Windows PowerShell from the project root:

```powershell
cd "C:\Users\OM MAHAJAN\Dev_Om\hackathon\VoltIQ"
```

## First-time setup

Install Python 3.12, a Java 17 JDK, and Node.js 22 or newer. Then run:

```powershell
py -3.12 -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt -c backend/requirements-lock.txt
cd voltiq
npm ci
cd ..
```

Prepare the Chronos model once while connected to the internet:

```powershell
cd backend
.venv/Scripts/python.exe -m pip install -r requirements-ml.txt -c requirements-lock.txt
.venv/Scripts/python.exe prepare_model.py
cd ..
```

## Persistent Windows Hadoop configuration

The current machine is already configured with `C:\hadoop-3.3.4`, including `bin\winutils.exe`. Open a new normal PowerShell window and verify that the user-level configuration was loaded:

```powershell
$env:HADOOP_HOME
$env:Path -split ";" | Select-String -SimpleMatch "C:\hadoop-3.3.4\bin"
Test-Path "$env:HADOOP_HOME\bin\winutils.exe"
```

Expected output includes `C:\hadoop-3.3.4`, `C:\hadoop-3.3.4\bin`, and `True`.

If a future Windows account or machine does not have these values, save them for that user once:

```powershell
[Environment]::SetEnvironmentVariable("HADOOP_HOME", "C:\hadoop-3.3.4", "User")
[Environment]::SetEnvironmentVariable("hadoop.home.dir", "C:\hadoop-3.3.4", "User")

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$hadoopBin = "C:\hadoop-3.3.4\bin"
if (($userPath -split ";") -notcontains $hadoopBin) {
  [Environment]::SetEnvironmentVariable("Path", "$hadoopBin;$userPath", "User")
}
```

Close and reopen PowerShell after setting these values.

## Verify Spark on this Windows machine

This is the remaining backend test gate. Run it in your own normal PowerShell session, not inside a restricted execution environment:

```powershell
java -version
backend/.venv/Scripts/python.exe --version
backend/.venv/Scripts/python.exe -m pytest backend/tests/test_processing.py::SparkNumericalTests -q -p no:cacheprovider --basetemp backend/pytest-spark-temp
```

Expected result:

```text
2 passed
```

`winutils.exe` and native-Hadoop warnings can appear. They are not a failure on their own. If the command fails with `Unable to establish loopback connection`, Spark is being blocked before the project tests run; copy the final traceback rather than changing the processed dataset or rerunning imports.

## Start the application

Open three PowerShell terminals.

Terminal 1, API:

```powershell
cd "C:\Users\OM MAHAJAN\Dev_Om\hackathon\VoltIQ\backend"
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Terminal 2, job worker:

```powershell
cd "C:\Users\OM MAHAJAN\Dev_Om\hackathon\VoltIQ\backend"
.venv/Scripts/python.exe -m app.worker
```

Terminal 3, frontend:

```powershell
cd "C:\Users\OM MAHAJAN\Dev_Om\hackathon\VoltIQ\voltiq"
npm run dev
```

Open `http://127.0.0.1:3000`.

## Test the source

```powershell
cd "C:\Users\OM MAHAJAN\Dev_Om\hackathon\VoltIQ\voltiq"
npm test
npm run typecheck
npm run build
cd ..
backend/.venv/Scripts/python.exe -m pytest backend/tests/test_models.py backend/tests/test_workflow.py backend/tests/test_processing.py::MappingTests -q -p no:cacheprovider --basetemp backend/pytest-other-temp
```

The full setup, dataset import, processing, and model instructions are in `instructions.md`.
