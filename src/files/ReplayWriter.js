define([
  'lib/glMatrix',
  'lib/FileSaver',
  'editor/Sculpt',
  'files/ExportSGL',
  'files/ReplayEnums',
  'misc/Tablet'
], function (glm, saveAs, Sculpt, ExportSGL, Replay, Tablet) {

  'use strict';

  var vec3 = glm.vec3;

  var ReplayWriter = function (main) {
    this.main_ = main; // main application

    this.firstReplay_ = null; // first part of the replaying (if we are importing a replayer)
    this.nbBytesLoadingMeshes_ = 0; // nb bytes of loaded meshes

    // (for now we don't serialize 64b data so 32b for each stack action
    // is enough for an upper estimation when exporting the replay file)
    this.stack_ = []; // stack of input action

    this.lastRadius_ = 50.0; // last radius
    this.sculpt_ = new Sculpt(); // states of sculpting tools
    this.pressureOnRadius_ = true; // pressure on radius
    this.pressureOnIntensity_ = false; // pressure on intensity
    this.pressure_ = 1.0; // tablet pressure

    this.autoUpload_ = true; // send file if it's not too big :D
    this.lastNbActions_ = 0; // nb of last checked stack action
    this.uid_ = new Date().getTime(); // best uid ever
    this.cbCheckUpload_ = window.setTimeout.bind(window, this.checkUpload.bind(this), 20000);
    this.checkUpload();
  };

  ReplayWriter.prototype = {
    checkUpload: function () {
      var nbActions = this.stack_.length;
      // 5 Mb limits
      if (this.nbBytesLoadingMeshes_ > 10000000 || nbActions === this.lastNbActions_ || nbActions < 5000) {
        this.cbCheckUpload_();
        return;
      }
      parent.location.hash = this.uid_;
      this.lastNbActions_ = nbActions;

      var fd = new FormData();
      fd.append('filename', this.uid_ + '.rep');
      fd.append('file', this.export());

      var xhr = new XMLHttpRequest();
      xhr.open('POST', 'http://stephaneginier.com/replays/replayUpload.php', true);
      xhr.onload = this.cbCheckUpload_;
      xhr.send(fd);
    },
    reset: function () {
      this.uid_ = new Date().getTime();
      parent.location.hash = '';
      this.lastDeviceMove_ = undefined;
      this.lastExposure_ = undefined;
      this.lastFov_ = undefined;
      this.lastNbActions_ = 0;
      this.lastRadius_ = 50.0;

      this.pressure_ = 1.0;
      this.tUseOnRadius_ = true;
      this.tUseOnIntensity_ = false;
      this.firstReplay_ = null;
      this.nbBytesLoadingMeshes_ = 0;
      this.stack_.length = 0;
      this.sculpt_ = new Sculpt();

      var cam = this.main_.getCamera();
      this.pushCameraSize(cam.width_, cam.height_);
      this.pushCameraMode(cam.getMode());
      this.pushCameraProjType(cam.getProjType());
      this.pushCameraFov(cam.getFov());
      if (cam.getUsePivot()) this.pushCameraTogglePivot();
    },
    setFirstReplay: function (buffer) {
      this.stack_.length = 0;
      this.firstReplay_ = buffer;
    },
    checkSculptTools: function () {
      if (Tablet.useOnRadius !== this.pressureOnRadius_) {
        this.pressureOnRadius_ = Tablet.useOnRadius;
        this.stack_.push(Replay.TABLET_TOGGLE_RADIUS);
      }
      if (Tablet.useOnIntensity !== this.pressureOnIntensity_) {
        this.pressureOnIntensity_ = Tablet.useOnIntensity;
        this.stack_.push(Replay.TABLET_TOGGLE_INTENSITY);
      }
      var pre = Tablet.pressure();
      if (pre !== this.pressure_) {
        this.pressure_ = pre;
        this.stack_.push(Replay.TABLET_PRESSURE, pre);
      }

      var radius = this.main_.getPicking().getScreenRadius();
      if (radius !== this.lastRadius_) {
        this.lastRadius_ = radius;
        this.stack_.push(Replay.SCULPT_RADIUS, radius);
      }

      var mainSc = this.main_.getSculpt();
      var replaySc = this.sculpt_;

      if (mainSc.symmetry_ !== replaySc.symmetry_) {
        replaySc.symmetry_ = mainSc.symmetry_;
        this.stack_.push(Replay.SCULPT_TOGGLE_SYMMETRY);
      }
      if (mainSc.continuous_ !== replaySc.continuous_) {
        replaySc.continuous_ = mainSc.continuous_;
        this.stack_.push(Replay.SCULPT_TOGGLE_CONTINUOUS);
      }

      var tool = mainSc.tool_;
      var mainSel = mainSc.getCurrentTool();

      if (replaySc.tool_ !== tool) {
        replaySc.tool_ = tool;
        this.stack_.push(Replay.SCULPT_TOOL, tool);
      }
      var replaySel = replaySc.getCurrentTool();

      switch (tool) {
      case Sculpt.tool.BRUSH:
        if (mainSel.intensity_ !== replaySel.intensity_) {
          replaySel.intensity_ = mainSel.intensity_;
          this.stack_.push(Replay.BRUSH_INTENSITY, mainSel.intensity_ * 100);
        }
        if (mainSel.negative_ !== replaySel.negative_) {
          replaySel.negative_ = mainSel.negative_;
          this.stack_.push(Replay.BRUSH_TOGGLE_NEGATIVE);
        }
        if (mainSel.clay_ !== replaySel.clay_) {
          replaySel.clay_ = mainSel.clay_;
          this.stack_.push(Replay.BRUSH_TOGGLE_CLAY);
        }
        if (mainSel.culling_ !== replaySel.culling_) {
          replaySel.culling_ = mainSel.culling_;
          this.stack_.push(Replay.BRUSH_TOGGLE_CULLING);
        }
        if (mainSel.accumulate_ !== replaySel.accumulate_) {
          replaySel.accumulate_ = mainSel.accumulate_;
          this.stack_.push(Replay.BRUSH_TOGGLE_ACCUMULATE);
        }
        break;
      case Sculpt.tool.CREASE:
        if (mainSel.intensity_ !== replaySel.intensity_) {
          replaySel.intensity_ = mainSel.intensity_;
          this.stack_.push(Replay.CREASE_INTENSITY, mainSel.intensity_ * 100);
        }
        if (mainSel.negative_ !== replaySel.negative_) {
          replaySel.negative_ = mainSel.negative_;
          this.stack_.push(Replay.CREASE_TOGGLE_NEGATIVE);
        }
        if (mainSel.culling_ !== replaySel.culling_) {
          replaySel.culling_ = mainSel.culling_;
          this.stack_.push(Replay.CREASE_TOGGLE_CULLING);
        }
        break;
      case Sculpt.tool.INFLATE:
        if (mainSel.intensity_ !== replaySel.intensity_) {
          replaySel.intensity_ = mainSel.intensity_;
          this.stack_.push(Replay.INFLATE_INTENSITY, mainSel.intensity_ * 100);
        }
        if (mainSel.negative_ !== replaySel.negative_) {
          replaySel.negative_ = mainSel.negative_;
          this.stack_.push(Replay.INFLATE_TOGGLE_NEGATIVE);
        }
        if (mainSel.culling_ !== replaySel.culling_) {
          replaySel.culling_ = mainSel.culling_;
          this.stack_.push(Replay.INFLATE_TOGGLE_CULLING);
        }
        break;
      case Sculpt.tool.FLATTEN:
        if (mainSel.intensity_ !== replaySel.intensity_) {
          replaySel.intensity_ = mainSel.intensity_;
          this.stack_.push(Replay.FLATTEN_INTENSITY, mainSel.intensity_ * 100);
        }
        if (mainSel.negative_ !== replaySel.negative_) {
          replaySel.negative_ = mainSel.negative_;
          this.stack_.push(Replay.FLATTEN_TOGGLE_NEGATIVE);
        }
        if (mainSel.culling_ !== replaySel.culling_) {
          replaySel.culling_ = mainSel.culling_;
          this.stack_.push(Replay.FLATTEN_TOGGLE_CULLING);
        }
        break;
      case Sculpt.tool.PINCH:
        if (mainSel.intensity_ !== replaySel.intensity_) {
          replaySel.intensity_ = mainSel.intensity_;
          this.stack_.push(Replay.PINCH_INTENSITY, mainSel.intensity_ * 100);
        }
        if (mainSel.negative_ !== replaySel.negative_) {
          replaySel.negative_ = mainSel.negative_;
          this.stack_.push(Replay.PINCH_TOGGLE_NEGATIVE);
        }
        if (mainSel.culling_ !== replaySel.culling_) {
          replaySel.culling_ = mainSel.culling_;
          this.stack_.push(Replay.PINCH_TOGGLE_CULLING);
        }
        break;
      case Sculpt.tool.SMOOTH:
        if (mainSel.intensity_ !== replaySel.intensity_) {
          replaySel.intensity_ = mainSel.intensity_;
          this.stack_.push(Replay.SMOOTH_INTENSITY, mainSel.intensity_ * 100);
        }
        if (mainSel.culling_ !== replaySel.culling_) {
          replaySel.culling_ = mainSel.culling_;
          this.stack_.push(Replay.SMOOTH_TOGGLE_CULLING);
        }
        if (mainSel.tangent_ !== replaySel.tangent_) {
          replaySel.tangent_ = mainSel.tangent_;
          this.stack_.push(Replay.SMOOTH_TOGGLE_TANGENT);
        }
        break;
      case Sculpt.tool.TWIST:
        if (mainSel.culling_ !== replaySel.culling_) {
          replaySel.culling_ = mainSel.culling_;
          this.stack_.push(Replay.TWIST_TOGGLE_CULLING);
        }
        break;
      case Sculpt.tool.SCALE:
        if (mainSel.culling_ !== replaySel.culling_) {
          replaySel.culling_ = mainSel.culling_;
          this.stack_.push(Replay.SCALE_TOGGLE_CULLING);
        }
        break;
      case Sculpt.tool.PAINT:
        // optimize a bit
        if (mainSel.pickColor_)
          break;
        if (mainSel.intensity_ !== replaySel.intensity_) {
          replaySel.intensity_ = mainSel.intensity_;
          this.stack_.push(Replay.PAINT_INTENSITY, mainSel.intensity_ * 100);
        }
        if (mainSel.material_[0] !== replaySel.material_[0]) {
          replaySel.material_[0] = mainSel.material_[0];
          this.stack_.push(Replay.PAINT_ROUGHNESS, mainSel.material_[0]);
        }
        if (mainSel.material_[1] !== replaySel.material_[1]) {
          replaySel.material_[1] = mainSel.material_[1];
          this.stack_.push(Replay.PAINT_METALLIC, mainSel.material_[1]);
        }
        if (mainSel.culling_ !== replaySel.culling_) {
          replaySel.culling_ = mainSel.culling_;
          this.stack_.push(Replay.PAINT_TOGGLE_CULLING);
        }
        if (vec3.sqrDist(mainSel.color_, replaySel.color_) !== 0.0) {
          vec3.copy(replaySel.color_, mainSel.color_);
          this.stack_.push(Replay.PAINT_COLOR, mainSel.color_[0], mainSel.color_[1], mainSel.color_[2]);
        }
        break;
      }
    },
    pushCameraSize: function (w, h) {
      this.stack_.push(Replay.CAMERA_SIZE, w, h);
    },
    pushUpdateContinuous: function () {
      this.stack_.push(Replay.SCULPT_UPDATE_CONTINOUS);
    },
    pushDeviceDown: function (button, x, y, event) {
      this.checkSculptTools();
      var mask = 0;
      if (event.ctrlKey) mask |= Replay.CTRL;
      if (event.altKey) mask |= Replay.ALT;
      this.stack_.push(Replay.DEVICE_DOWN, button, x, y, mask);
    },
    pushDeviceUp: function () {
      this.checkSculptTools();
      this.stack_.push(Replay.DEVICE_UP);
    },
    pushDeviceWheel: function (delta) {
      this.stack_.push(Replay.DEVICE_WHEEL, delta);
    },
    pushDeviceMove: function (x, y) {
      // optimize a bit
      if (this.main_.mouseButton_ === 0) {
        if (this.lastDeviceMove_ === this.stack_.length - 3) {
          this.stack_[this.stack_.length - 2] = x;
          this.stack_[this.stack_.length - 1] = y;
          return;
        }
      }
      this.lastDeviceMove_ = this.stack_.length;

      this.checkSculptTools();
      this.stack_.push(Replay.DEVICE_MOVE, x, y);
    },
    pushUndo: function () {
      this.stack_.push(Replay.UNDO);
    },
    pushRedo: function () {
      this.stack_.push(Replay.REDO);
    },
    pushCameraFps: function () {
      var cam = this.main_.getCamera();
      this.stack_.push(Replay.CAMERA_FPS, cam.moveX_, cam.moveZ_);
    },
    pushCameraMode: function (mode) {
      this.stack_.push(Replay.CAMERA_MODE, mode);
    },
    pushCameraProjType: function (type) {
      this.stack_.push(Replay.CAMERA_PROJ_TYPE, type);
    },
    pushCameraFov: function (fov) {
      // optimize a bit
      if (this.lastFov_ === this.stack_.length - 2) {
        this.stack_[this.stack_.length - 1] = fov;
        return;
      }
      this.lastFov_ = this.stack_.length;
      this.stack_.push(Replay.CAMERA_FOV, fov);
    },
    pushCameraTogglePivot: function () {
      this.stack_.push(Replay.CAMERA_TOGGLE_PIVOT);
    },
    pushCameraReset: function () {
      this.stack_.push(Replay.CAMERA_RESET);
    },
    pushCameraResetFront: function () {
      this.stack_.push(Replay.CAMERA_RESET_FRONT);
    },
    pushCameraResetLeft: function () {
      this.stack_.push(Replay.CAMERA_RESET_LEFT);
    },
    pushCameraResetTop: function () {
      this.stack_.push(Replay.CAMERA_RESET_TOP);
    },
    pushMultiSubdivide: function () {
      this.stack_.push(Replay.MULTI_SUBDIVIDE);
    },
    pushMultiReverse: function () {
      this.stack_.push(Replay.MULTI_REVERSE);
    },
    pushMultiResolution: function (value) {
      this.stack_.push(Replay.MULTI_RESOLUTION, value);
    },
    pushDeleteLower: function () {
      this.stack_.push(Replay.MULTI_DEL_LOWER);
    },
    pushDeleteHigher: function () {
      this.stack_.push(Replay.MULTI_DEL_HIGHER);
    },
    pushVoxelRemesh: function (res) {
      this.stack_.push(Replay.VOXEL_REMESH, res);
    },
    pushDynamicToggleActivate: function () {
      this.stack_.push(Replay.DYNAMIC_TOGGLE_ACTIVATE);
    },
    pushDynamicToggleLinear: function () {
      this.stack_.push(Replay.DYNAMIC_TOGGLE_LINEAR);
    },
    pushDynamicSubdivision: function (val) {
      this.stack_.push(Replay.DYNAMIC_SUBDIVISION, val);
    },
    pushDynamicDecimation: function (val) {
      this.stack_.push(Replay.DYNAMIC_DECIMATION, val);
    },
    pushLoadMeshes: function (meshes, fdata, type) {
      var ab = type === 'sgl' ? fdata.slice() : ExportSGL.exportSGLAsArrayBuffer(meshes);
      this.nbBytesLoadingMeshes_ += ab.byteLength;
      this.stack_.push(Replay.LOAD_MESHES, ab);
    },
    pushAddSphere: function () {
      this.stack_.push(Replay.ADD_SPHERE);
    },
    pushDeleteMesh: function () {
      this.stack_.push(Replay.DELETE_CURRENT_MESH);
    },
    pushExposure: function (val) {
      // optimize a bit
      if (this.lastExposure_ === this.stack_.length - 2) {
        this.stack_[this.stack_.length - 1] = val;
        return;
      }
      this.lastExposure_ = this.stack_.length;
      this.stack_.push(Replay.EXPOSURE_INTENSITY, val);
    },
    pushShowGrid: function (bool) {
      this.stack_.push(Replay.SHOW_GRID, bool);
    },
    pushFlatShading: function (bool) {
      this.stack_.push(Replay.FLAT_SHADING, bool);
    },
    pushShowWireframe: function (bool) {
      this.stack_.push(Replay.SHOW_WIREFRAME, bool);
    },
    pushShaderSelect: function (val) {
      this.stack_.push(Replay.SHADER_SELECT, val);
    },
    pushMatcapSelect: function (val) {
      this.stack_.push(Replay.MATCAP_SELECT, val);
    },
    export: function () {
      var stack = this.stack_;
      var nb = stack.length;

      var offset = this.firstReplay_ ? this.firstReplay_.byteLength : 0;
      var buffer = new ArrayBuffer(this.nbBytesLoadingMeshes_ + offset + (nb + 2) * 4);

      var data = new DataView(buffer);
      var u8a = new Uint8Array(buffer);

      if (this.firstReplay_)
        u8a.set(new Uint8Array(this.firstReplay_));
      else {
        data.setUint32(0, Replay.CODE);
        data.setUint32(4, Replay.VERSION);
        offset += 8 + 4; // code(4o) + version(4o) + nbytes (4o)
      }
      data.setUint32(8, data.getUint32(8) + this.nbBytesLoadingMeshes_);

      for (var i = 0; i < nb; ++i) {
        var ac = stack[i];
        data.setUint8(offset++, ac);
        switch (ac) {
        case Replay.DEVICE_MOVE:
          data.setUint16(offset, stack[++i]);
          data.setUint16(offset + 2, stack[++i]);
          offset += 4;
          break;
        case Replay.DEVICE_DOWN:
          data.setUint8(offset, stack[++i]);
          data.setUint16(offset + 1, stack[++i]);
          data.setUint16(offset + 3, stack[++i]);
          data.setUint8(offset + 5, stack[++i]);
          offset += 6;
          break;
        case Replay.DEVICE_WHEEL:
          data.setInt8(offset, stack[++i]);
          offset += 1;
          break;
        case Replay.CAMERA_SIZE:
          data.setUint16(offset, stack[++i]);
          data.setUint16(offset + 2, stack[++i]);
          offset += 4;
          break;
        case Replay.CAMERA_FPS:
          data.setInt8(offset, stack[++i]);
          data.setInt8(offset + 1, stack[++i]);
          offset += 2;
          break;
        case Replay.CAMERA_MODE:
        case Replay.CAMERA_PROJ_TYPE:
        case Replay.CAMERA_FOV:
        case Replay.SCULPT_TOOL:
        case Replay.SCULPT_RADIUS:
        case Replay.BRUSH_INTENSITY:
        case Replay.CREASE_INTENSITY:
        case Replay.FLATTEN_INTENSITY:
        case Replay.INFLATE_INTENSITY:
        case Replay.PINCH_INTENSITY:
        case Replay.SMOOTH_INTENSITY:
        case Replay.PAINT_INTENSITY:
        case Replay.MULTI_RESOLUTION:
        case Replay.DYNAMIC_SUBDIVISION:
        case Replay.DYNAMIC_DECIMATION:
        case Replay.EXPOSURE_INTENSITY:
        case Replay.SHOW_GRID:
        case Replay.SHOW_WIREFRAME:
        case Replay.FLAT_SHADING:
        case Replay.SHADER_SELECT:
        case Replay.MATCAP_SELECT:
          data.setUint8(offset, stack[++i]);
          offset += 1;
          break;
        case Replay.PAINT_COLOR:
          data.setFloat32(offset, stack[++i]);
          data.setFloat32(offset + 4, stack[++i]);
          data.setFloat32(offset + 8, stack[++i]);
          offset += 12;
          break;
        case Replay.PAINT_ROUGHNESS:
        case Replay.PAINT_METALLIC:
        case Replay.TABLET_PRESSURE:
          data.setFloat32(offset, stack[++i]);
          offset += 4;
          break;
        case Replay.VOXEL_REMESH:
          data.setUint16(offset, stack[++i]);
          offset += 2;
          break;
        case Replay.LOAD_MESHES:
          var ab = stack[++i];
          data.setUint32(offset, ab.byteLength);
          u8a.set(new Uint8Array(ab), offset + 4);
          offset += 4 + ab.byteLength;
          break;
        }
      }

      data = new DataView(buffer, 0, offset);
      return new Blob([data]);
    }
  };

  return ReplayWriter;
});