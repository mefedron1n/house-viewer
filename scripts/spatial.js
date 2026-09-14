// Affine map from normalized image coordinates (x, z down) to model world X/Z.
(() => {
  const finitePoint = (p) => Number.isFinite(p?.x) && Number.isFinite(p?.z);
  function validTriangle(points) {
    if (points?.length !== 3 || !points.every(finitePoint)) return false;
    const [a, b, c] = points;
    const area = (b.x-a.x)*(c.z-a.z)-(c.x-a.x)*(b.z-a.z);
    const scale = Math.max(...points.map((p, i) => {
      const q = points[(i+1)%3];
      return (p.x-q.x)**2+(p.z-q.z)**2;
    }));
    return scale > 0 && Math.abs(area) / scale > 0.01;
  }
  function solveAffine(imagePoints, worldPoints) {
    if (!validTriangle(imagePoints) || !validTriangle(worldPoints)) return null;
    const [p, q, r] = imagePoints, [u, v, w] = worldPoints;
    const det = (q.x-p.x)*(r.z-p.z)-(r.x-p.x)*(q.z-p.z);
    const coefficients = (key) => {
      const a = ((v[key]-u[key])*(r.z-p.z)-(w[key]-u[key])*(q.z-p.z))/det;
      const b = ((q.x-p.x)*(w[key]-u[key])-(r.x-p.x)*(v[key]-u[key]))/det;
      return [a, b, u[key]-a*p.x-b*p.z];
    };
    const [a,b,c] = coefficients('x'), [d,e,f] = coefficients('z');
    const matrix = {a,b,c,d,e,f};
    return validCalibration({version: 1, matrix}) ? matrix : null;
  }
  function validCalibration(value) {
    const m = value?.matrix;
    return value?.version === 1 && m && ['a','b','c','d','e','f'].every(k => Number.isFinite(m[k]) && Math.abs(m[k]) <= 1e9)
      && Math.abs(m.a*m.e-m.b*m.d) >= 1e-10;
  }
  function worldToImage(m, p) {
    if (!finitePoint(p) || !validCalibration({version: 1, matrix: m})) return null;
    const x = p.x-m.c, z = p.z-m.f, det = m.a*m.e-m.b*m.d;
    return {x: (m.e*x-m.b*z)/det, z: (m.a*z-m.d*x)/det};
  }
  function imageToWorld(m, p) {
    if (!finitePoint(p) || !validCalibration({version: 1, matrix: m})) return null;
    return {x: m.a*p.x+m.b*p.z+m.c, z: m.d*p.x+m.e*p.z+m.f};
  }
  window.RoomarkSpatial = {solveAffine, validCalibration, worldToImage, imageToWorld};
})();
