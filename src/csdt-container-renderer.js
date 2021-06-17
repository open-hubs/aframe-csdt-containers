AFRAME.registerComponent('csdt-container-renderer', {
  init: function () {
    const el = this.el;

    el.camPos = new THREE.Vector3();
    el.tmpVector = new THREE.Vector3();
    el.raycaster = new THREE.Raycaster();
    el.raycastCoords = new THREE.Vector2(0, 0);

    //temp values until we get data from the parent site
    const width = 512;
    const height = 512;

    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({ transparent: true });
    el.renderingPlane = new THREE.Mesh(geometry, material);

    el.orthoCamera = new THREE.OrthographicCamera(width / -2, width / 2, height / 2, height / -2, 1, 1000);
    el.orthoCamera.position.z = 5;

    el.frustum = new THREE.Frustum();
    el.frustumMatrix = new THREE.Matrix4();

    const handNames = ['left', 'right'];
    const hands = handNames.map((name) => {
      //listen to user input
      const hand = document.createElement('a-entity');
      hand.setAttribute('hand-controls', { hand: name });
      el.appendChild(hand);

      //pass user input to child sites
      this.handleInputEvent(hand, 'gripdown');
      this.handleInputEvent(hand, 'gripup');
      this.handleInputEvent(hand, 'pointup');
      this.handleInputEvent(hand, 'pointdown');
      this.handleInputEvent(hand, 'thumbup');
      this.handleInputEvent(hand, 'thumbdown');
      this.handleInputEvent(hand, 'pointingstart');
      this.handleInputEvent(hand, 'pointingend');
      this.handleInputEvent(hand, 'pistolstart');
      this.handleInputEvent(hand, 'pistolend');

      return hand;
    });

    el.handL = hands[0];
    el.handR = hands[1];
  },

  handleInputEvent: function (source, event) {
    const el = this.el;

    source.addEventListener(event, () => {
      //after an input, run this code on the next tock
      el.addEventListener(
        'tock',
        () => {
          this.cameraInContainer(event);
        },
        { once: true }
      );
    });
  },

  cameraInContainer: function (eventName) {
    const el = this.el;
    const containers = el.sceneEl.containers;
    const camera = el.sceneEl.camera;

    //see if the user is inside a container
    containers.forEach((obj) => {
      const mesh = obj.el.containerMesh;

      el.raycaster.setFromCamera(el.raycastCoords, camera);
      const intersects = el.raycaster.intersectObject(mesh);

      if (intersects.length % 2 === 1) {
        //user is in container
        //send input to child site
        obj.el.CSDT.dispatchEvent(eventName);
      }
    });
  },

  tock: function () {
    const el = this.el;
    const canvas = el.sceneEl.canvas;
    const width = canvas.width;
    const height = canvas.height;
    const camera = el.sceneEl.camera;
    const renderer = el.sceneEl.renderer;
    const gl = renderer.getContext();
    const containers = el.sceneEl.containers;
    renderer.autoClear = false;

    el.emit('tock');

    //keep hand-controls invisible
    el.handL.object3D.traverseVisible((obj) => (obj.visible = false));
    el.handR.object3D.traverseVisible((obj) => (obj.visible = false));

    if (el.renderingPlane.geometry.width !== width || el.renderingPlane.geometry.height !== height) {
      el.renderingPlane.geometry.dispose();
      el.renderingPlane.geometry = new THREE.PlaneGeometry(width, height);

      el.orthoCamera = new THREE.OrthographicCamera(width / -2, width / 2, height / 2, height / -2, 1, 1000);
      el.orthoCamera.position.z = 5;
    }

    el.frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    el.frustum.setFromProjectionMatrix(el.frustumMatrix);

    //sort containers by distance to camera
    //render farthest first
    el.camPos = camera.getWorldPosition(el.camPos);
    containers.forEach((obj) => {
      obj.distance = obj.el.object3D.getWorldPosition(el.tmpVector).distanceTo(el.camPos);
    });
    containers.sort((a, b) => b.distance - a.distance);

    const containerMeshes = new THREE.Group();
    const textures = [];

    containers.forEach((obj) => {
      if (!obj.el) return;
      if (obj.el.connection_established !== true) return;
      if (el.frustum.intersectsObject(obj.el.containerMesh) === false) return;

      if (++obj.el.frames % obj.el.frameSkips === 0) {
        obj.el.components['csdt-container'].syncData();
      }

      //read pixel data from child site
      const texture = new THREE.DataTexture(
        obj.el.pixels,
        width,
        height,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
        THREE.UVMapping
      );

      textures.push(texture);
      containerMeshes.add(obj.el.containerMesh);
    });

    //render containers into stencil buffer
    gl.enable(gl.STENCIL_TEST);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    gl.stencilFunc(gl.ALWAYS, 1, 0xff);
    gl.stencilMask(0xff);

    containerMeshes.children.forEach((obj) => (obj.visible = true));
    renderer.render(containerMeshes, camera);
    containerMeshes.children.forEach((obj) => (obj.visible = false));

    //render pixel data, using the stencil buffer as a mask
    renderer.clearDepth();
    gl.stencilFunc(gl.EQUAL, 1, 0xff);
    gl.stencilMask(0x00);

    textures.forEach((texture) => {
      el.renderingPlane.material.map = texture;
      renderer.render(el.renderingPlane, el.orthoCamera);
      texture.dispose();
    });

    gl.stencilMask(0xff);
    gl.disable(gl.STENCIL_TEST);
  },
});