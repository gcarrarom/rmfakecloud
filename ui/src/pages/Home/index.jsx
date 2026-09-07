import Container from "react-bootstrap/Container";
import Card from "react-bootstrap/Card";
import { useEffect, useState } from "react";

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = "B";
  for (const nextUnit of units) {
    value /= 1024;
    unit = nextUnit;
    if (value < 1024 || nextUnit === units[units.length - 1]) break;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

const Home = () => {
  const [storageUsage, setStorageUsage] = useState(null);

  useEffect(() => {
    fetch("/ui/api/storage-usage")
      .then((response) => {
        if (!response.ok) throw new Error(response.statusText);
        return response.json();
      })
      .then((data) => setStorageUsage(data.usedBytes))
      .catch(() => setStorageUsage(null));
  }, []);

  return (
    <Container fluid>
      <main>
        <h1>Welcome to your own reMarkable Cloud!</h1>
        <Card className="mb-4" style={{ maxWidth: "32rem" }}>
          <Card.Body>
            <Card.Title>Cloud storage used</Card.Title>
            <Card.Text className="mb-0">
              {storageUsage === null ? "Storage usage unavailable" : formatBytes(storageUsage)}
            </Card.Text>
          </Card.Body>
        </Card>
        <h2>About</h2>
        <p>
          This software is an unofficial replacement for the proprietary
          reMarkable Cloud.  In case you want to sync/backup your files
          and have full control of the hosting environment, this is the
          software for you.
        </p>
        <p>
          It's is still a work in progress being, actively maintained over
          on <a href="https://github.com/ddvk/rmfakecloud">GitHub</a>.
        </p>
        <h2>Tips</h2>
        <ul>
          <li>
            <p>
              You can use <a href="https://github.com/ddvk/rmapi">rmapi</a> for managing files,
              just specify the URL of your instance with the RMAPI_HOST variable like
              so: <code>RMAPI_HOST=https://rmfakecloud.example.com rmapi</code>
            </p>
            <ul>
              <li>
                <p>
                  Do note that the original project is now unmaintained. You should consider
                  using <a href="https://github.com/ddvk/rmapi">this fork</a> instead.
                </p>
              </li>
            </ul>
          </li>
          <li>
            <p>
              Check out the online <a href="https://ddvk.github.io/rmfakecloud/">documentation</a> to
              learn more about the configuration options. Also read the README
            </p>
          </li>
          <li>
            <p>
              You should also read the <a href="https://github.com/ddvk/rmfakecloud/blob/master/README.md">README</a>,
              to see the current status of the project and notes from the developers.
            </p>
          </li>
          <li>
            <p>
              We support the Read on reMarkable Extension. Read more about it in the online documentation.
            </p>
          </li>
          <li>
            <p>
              Documents will be uploaded to the selected (highlighted) directory.
            </p>
            <ul>
              <li>
                <p>
                  Select directories by clicking on them.
                </p>
              </li>
              <li>
                <p>
                  Clicking on selected directories again will open or close them respectively.
                </p>
              </li>
            </ul>
          </li>
        </ul>
      </main>
    </Container>
  );
};

export default Home;
