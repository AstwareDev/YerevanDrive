// Republic Square cast-iron lamps (seen in the 360 Stories ground-level views): black fluted column on a stone plinth, collar rings, and a crown of
// five opal globes (one on top, four on curved arms). Instanced; the globes glow at night through the shared `fx` fade list used by the street lamps.
export function buildOrnateLamps(THREE, mergeGeometries, positions, fx, parent) {
  if (!positions.length) return null;
  const T = (g, x, y, z) => g.translate(x, y, z);
  const iron = [
    T(new THREE.CylinderGeometry(0.30, 0.34, 0.55, 10), 0, 0.275, 0),                 // plinth
    T(new THREE.CylinderGeometry(0.17, 0.2, 0.5, 10), 0, 0.8, 0),                      // foot
    T(new THREE.CylinderGeometry(0.09, 0.14, 3.2, 10), 0, 2.65, 0),                    // column
    T(new THREE.TorusGeometry(0.15, 0.035, 6, 12).rotateX(Math.PI / 2), 0, 1.6, 0),    // collars
    T(new THREE.TorusGeometry(0.12, 0.035, 6, 12).rotateX(Math.PI / 2), 0, 3.0, 0),
    T(new THREE.CylinderGeometry(0.2, 0.09, 0.3, 10), 0, 4.1, 0),                      // crown bowl
    T(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6), 0, 4.55, 0),                     // centre stem
    T(new THREE.TorusGeometry(0.46, 0.022, 5, 18).rotateX(Math.PI / 2), 0, 4.25, 0),   // arm ring
  ];
  const glass = [T(new THREE.SphereGeometry(0.23, 12, 8), 0, 5.05, 0)];                // top globe
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4, x = Math.cos(a) * 0.46, z = Math.sin(a) * 0.46;
    glass.push(T(new THREE.SphereGeometry(0.17, 10, 7), x, 4.5, z));
    const arm = new THREE.CylinderGeometry(0.02, 0.02, 0.6, 5); arm.rotateZ(0); T(arm, x, 4.25, z);
    iron.push(arm);
    iron.push(T(new THREE.CylinderGeometry(0.1, 0.07, 0.07, 8), x, 4.33, z));          // globe cup
  }
  const ironM = new THREE.MeshStandardMaterial({ color: 0x141519, roughness: 0.45, metalness: 0.75 });
  const glassM = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.7, 2.3, 1.6), toneMapped: false }); fx.push({ color: glassM.color, base: glassM.color.clone(), floor: 0.3 });
  const ig = mergeGeometries(iron), gg = mergeGeometries(glass), n = positions.length;
  const im = new THREE.InstancedMesh(ig, ironM, n), gm = new THREE.InstancedMesh(gg, glassM, n), m4 = new THREE.Matrix4();
  positions.forEach(([x, y, z], i) => { m4.makeTranslation(x, y, z); im.setMatrixAt(i, m4); gm.setMatrixAt(i, m4); });
  im.castShadow = true; im.frustumCulled = false; gm.frustumCulled = false; im.name = 'ornate-lamps'; gm.name = 'ornate-lamp-globes';
  parent.add(im, gm); return { iron: im, glass: gm, count: n };
}
