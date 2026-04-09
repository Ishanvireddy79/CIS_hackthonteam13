from flask import Flask, jsonify, render_template
import json, shutil, random, datetime

app = Flask(__name__)

SOURCE = "data/source.json"
TARGET = "data/target.json"
BACKUP = "data/backup.json"
LOGS = "logs.txt"

def log(message):
    with open(LOGS, "a") as f:
        f.write(f"{datetime.datetime.now()} - {message}\n")

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/migrate")
def migrate():
    try:
        shutil.copy(SOURCE, BACKUP)
        log("Backup created")

        # simulate failure randomly
        if random.choice([True, False]):
            raise Exception("Simulated Failure")

        with open(SOURCE) as s, open(TARGET, "w") as t:
            data = json.load(s)
            json.dump(data, t)

        log("Migration successful")
        return jsonify({"status": "Migration Success"})

    except Exception as e:
        log("Migration failed: " + str(e))
        return jsonify({"status": "Failed", "error": str(e)})

@app.route("/restore")
def restore():
    shutil.copy(BACKUP, TARGET)
    log("Restore completed")
    return jsonify({"status": "Restored from backup"})

@app.route("/validate")
def validate():
    with open(SOURCE) as s, open(TARGET) as t:
        if json.load(s) == json.load(t):
            return jsonify({"status": "Data Consistent ✅"})
        else:
            return jsonify({"status": "Data Mismatch ❌"})

@app.route("/logs")
def logs():
    try:
        with open(LOGS) as f:
            return "<br>".join(f.readlines())
    except:
        return "No logs yet"

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000)