/**
 * Painter绘图模块
 *
 * @author Kener (@Kener-林峰, linzhifeng@baidu.com)
 *         errorrik (errorrik@gmail.com)
 */



define(
    function (require) {
        var config = require('./config');

        // retina 屏幕优化
        var devicePixelRatio = window.devicePixelRatio || 1;
        var vmlCanvasManager = window.G_vmlCanvasManager;
        
        function log() {
            var zrender = require('./zrender');
            zrender.log.apply(zrender, arguments);
        }

        function isCatchBrushException() {
            return require('./zrender').catchBrushException;
        }

        /**
         * 返回false的方法，用于避免页面被选中
         * 
         * @inner
         */
        function returnFalse() {
            return false;
        }

        /**
         * 什么都不干的空方法
         * 
         * @inner
         */
        function doNothing() {}

        /**
         * 绘图类 (V)
         * @param {HTMLElement} root 绘图区域
         * @param {storage} storage Storage实例
         * @param {Object} shape 图形库
         */
        function Painter(root, storage, shape) {
            this.root = root;
            this.storage = storage;
            this.shape = shape;

            root.innerHTML = '';
            this._width = this._getWidth(); // 宽，缓存记录
            this._height = this._getHeight(); // 高，缓存记录

            var domRoot = document.createElement('div');
            this._domRoot = domRoot;

            domRoot.onselectstart = returnFalse; // 避免页面选中的尴尬
            domRoot.style.position = 'relative';
            domRoot.style.overflow = 'hidden';
            domRoot.style.width = this._width + 'px';
            domRoot.style.height = this._height + 'px';
            root.appendChild(domRoot);

            this._domList = {};       //canvas dom元素
            this._ctxList = {};       //canvas 2D context对象，与domList对应
            this._domListBack = {};
            this._ctxListBack = {};
            
           
            this._zLevelConfig = {}; // 每个zLevel 的配置，@config clearColor
            this._maxZlevel = storage.getMaxZlevel(); //最大zlevel，缓存记录
            // this._loadingTimer 

            this.shapeToImage = this._createShapeToImageProcessor();

            // 创建各层canvas
            // 背景
            this._domList.bg = createDom('bg', 'div', this);
            domRoot.appendChild(this._domList.bg);

            var canvasElem;
            var canvasCtx;

            // 实体
            for (var i = 0; i <= this._maxZlevel; i++) {
                canvasElem = createDom(i, 'canvas', this);
                domRoot.appendChild(canvasElem);
                this._domList[i] = canvasElem;
                vmlCanvasManager && vmlCanvasManager.initElement(canvasElem);

                this._ctxList[i] = canvasCtx = canvasElem.getContext('2d');
                if (devicePixelRatio != 1) { 
                    canvasCtx.scale(devicePixelRatio, devicePixelRatio);
                }
            }

            // 高亮
            canvasElem = createDom('hover', 'canvas', this);
            canvasElem.id = '_zrender_hover_';
            domRoot.appendChild(canvasElem);
            this._domList.hover = canvasElem;
            vmlCanvasManager && vmlCanvasManager.initElement(canvasElem);

            this._ctxList.hover = canvasCtx = canvasElem.getContext('2d');
            if (devicePixelRatio != 1) {
                canvasCtx.scale(devicePixelRatio, devicePixelRatio);
            }
        }

        /**
         * 首次绘图，创建各种dom和context
         * 
         * @param {Function=} callback 绘画结束后的回调函数
         */
        Painter.prototype.render = function (callback) {
            if (this.isLoading()) {
                this.hideLoading();
            }

            //检查_maxZlevel是否变大，如是则同步创建需要的Canvas
            this._syncMaxZlevelCanvase();
            
            //清空已有内容，render默认为首次渲染
            this.clear();

            //升序遍历，shape上的zlevel指定绘画图层的z轴层叠
            this.storage.iterShape(
                this._brush({ all : true }),
                { normal: 'up' }
            );

            // update到最新则清空标志位
            this.storage.clearChangedZlevel();

            if (typeof callback == 'function') {
                callback();
            }

            return this;
        };

        /**
         * 刷新
         * 
         * @param {Function=} callback 刷新结束后的回调函数
         */
        Painter.prototype.refresh = function (callback) {
            //检查_maxZlevel是否变大，如是则同步创建需要的Canvas
            this._syncMaxZlevelCanvase();

            //仅更新有修改的canvas
            var changedZlevel = this.storage.getChangedZlevel();
            //擦除有修改的canvas
            if (changedZlevel.all){
                this.clear();
            }
            else {
                for (var k in changedZlevel) {
                    if (this._ctxList[k]) {
                        this.clearLayer(k);
                    }
                }
            }
            //重绘内容，升序遍历，shape上的zlevel指定绘画图层的z轴层叠
            this.storage.iterShape(
                this._brush(changedZlevel),
                { normal: 'up'}
            );

            // update到最新则清空标志位
            this.storage.clearChangedZlevel();

            if (typeof callback == 'function') {
                callback();
            }

            return this;
        };

        /**
         * 视图更新
         * 
         * @param {Array} shapeList 需要更新的图形元素列表
         * @param {Function} callback  视图更新后回调函数
         */
        Painter.prototype.update = function (shapeList, callback) {
            for (var i = 0, l = shapeList.length; i < l; i++) {
                var shape = shapeList[i];
                this.storage.mod(shape.id, shape);
            }

            this.refresh(callback);
            return this;
        };

        /**
         * 清除hover层外所有内容
         */
        Painter.prototype.clear = function () {
            for (var k in this._ctxList) {
                if (k == 'hover') {
                    continue;
                }

                this.clearLayer(k);
            }

            return this;
        };

        /**
         * 修改指定zlevel的绘制参数
         */
        Painter.prototype.modLayer = function (zLevel, config) {
            if (config) {
                var zLevelConfig = this._zLevelConfig;

                if (!zLevelConfig[zLevel]) {
                    zLevelConfig[zLevel] = {};
                }

                util.merge(zLevelConfig[zLevel], config, {
                    recursive : true,
                    overwrite : true
                });
            }
        };

        /**
         * 刷新hover层
         */
        Painter.prototype.refreshHover = function () {
            var me = this;
            function brushHover(e) {
                me._brushHover(e);
            }
            this.clearHover();
            this.storage.iterShape(brushHover, { hover: true });
            this.storage.delHover();

            return this;
        };

        /**
         * 清除hover层所有内容
         */
        Painter.prototype.clearHover = function () {
            var hover = this._ctxList && this._ctxList.hover;
            hover && hover.clearRect(
                0, 0, 
                this._width * devicePixelRatio, 
                this._height * devicePixelRatio
            );

            return this;
        };

        /**
         * 显示loading
         * 
         * @param {Object} loadingOption 选项，内容见下
         * @param {color} -.backgroundColor 背景颜色
         * @param {Object} -.textStyle 文字样式，同shape/text.style
         * @param {number=} -.progress 进度参数，部分特效有用
         * @param {Object=} -.effectOption 特效参数，部分特效有用
         * @param {string | function} -.effect 特效依赖tool/loadingEffect，
         *                                     可传入自定义特效function
         */
        Painter.prototype.showLoading = function (loadingOption) {
            var effect = require('./tool/loadingEffect');
            effect.stop(this._loadingTimer);

            loadingOption = loadingOption || {};
            loadingOption.effect = loadingOption.effect
                                   || config.loadingEffect;
            loadingOption.canvasSize = {
                width : this._width,
                height : this._height
            };

            var me = this;
            this._loadingTimer = effect.start(
                loadingOption,
                this.storage.addHover,
                function () { me.refreshHover(); }
            );
            this.loading = true;

            return this;
        };

        /**
         * loading结束
         * 乱来的，待重写
         */
        Painter.prototype.hideLoading = function () {
            var effect = require('./tool/loadingEffect');
            effect.stop(this._loadingTimer);

            this.clearHover();
            this.loading = false;
            return this;
        };

        /**
         * loading结束判断
         */
        Painter.prototype.isLoading = function () {
            return this.loading;
        };

        /**
         * 区域大小变化后重绘
         */
        Painter.prototype.resize = function () {
            var domRoot = this._domRoot;
            domRoot.style.display = 'none';

            var width = this._getWidth();
            var height = this._getHeight();

            domRoot.style.display = '';

            // 优化没有实际改变的resize
            if (this._width != width || height != this._height){
                this._width = width;
                this._height = height;

                domRoot.style.width = width + 'px';
                domRoot.style.height = height + 'px';

                for (var key in this._domList) {
                    var dom = this._domList[key];

                    dom.setAttribute('width', width);
                    dom.setAttribute('height', height);
                    dom.style.width = width + 'px';
                    dom.style.height = height + 'px';
                }

                this.storage.setChangedZlevle('all');
                this.refresh();
            }

            return this;
        };

        /**
         * 清除单独的一个层
         */
        Painter.prototype.clearLayer = function (k) {
            var zLevelConfigK = this._zLevelConfig[k];

            if (zLevelConfigK) {
                var haveClearColor = typeof(zLevelConfigK.clearColor) !== 'undefined';
                var haveMotionBLur = zLevelConfigK.motionBlur;
                var lastFrameAlpha = zLevelConfigK.lastFrameAlpha;
                if (typeof(lastFrameAlpha) == 'undefined') {
                    lastFrameAlpha = 0.7;
                }

                var canvasElem = this._domList[k];
                if (haveMotionBLur) {
                    if (typeof this._domListBack[k] === 'undefined') {
                        var backDom = createDom('back-' + k, 'canvas', this);
                        backDom.width = canvasElem.width;
                        backDom.height = canvasElem.height;
                        backDom.style.width = canvasElem.style.width;
                        backDom.style.height = canvasElem.style.height;
                        this._domListBack[k] = backDom;
                        this._ctxListBack[k] = backDom.getContext('2d');
                        devicePixelRatio != 1
                            && this._ctxListBack[k].scale(
                                   devicePixelRatio, devicePixelRatio
                               );
                    }
                    this._ctxListBack[k].globalCompositeOperation = 'copy';
                    this._ctxListBack[k].drawImage(
                        canvasElem, 0, 0,
                        canvasElem.width / devicePixelRatio,
                        canvasElem.height / devicePixelRatio
                    );
                }

                var canvasCtx = this._ctxList[k];
                if (haveClearColor) {
                    canvasCtx.save();
                    canvasCtx.fillStyle = zLevelConfigK.clearColor;
                    canvasCtx.fillRect(
                        0, 0,
                        this._width * devicePixelRatio, 
                        this._height * devicePixelRatio
                    );
                    canvasCtx.restore();
                }
                else {
                    canvasCtx.clearRect(
                        0, 0, 
                        this._width * devicePixelRatio, 
                        this._height * devicePixelRatio
                    );
                }

                if (haveMotionBLur) {
                    var backDom = this._domListBack[k];
                    canvasCtx.save();
                    canvasCtx.globalAlpha = lastFrameAlpha;
                    canvasCtx.drawImage(
                        backDom, 0, 0,
                        backDom.width / devicePixelRatio,
                        backDom.height / devicePixelRatio
                    );
                    canvasCtx.restore();
                }
            }
            else {
                this._ctxList[k].clearRect(
                    0, 0, 
                    this._width * devicePixelRatio, 
                    this._height * devicePixelRatio
                );
            }
        };

        /**
         * 释放
         */
        Painter.prototype.dispose = function () {
            if (this.isLoading()) {
                this.hideLoading();
            }

            this.root.innerHTML = '';

            this.root =
            this.storage =
            this.shape = 

            this._domRoot = 
            this._domList = 
            this._ctxList = 

            this._ctxListBack = 
            this._domListBack = null;
        };

        Painter.prototype.getDomHover = function () {
            return this._domList.hover;
        };

        Painter.prototype.toDataURL = function (type, backgroundColor, args) {
            if (vmlCanvasManager) {
                return null;
            }

            var imageDom = createDom('image', 'canvas', this);
            this._domList.bg.appendChild(imageDom);
            var ctx = imageDom.getContext('2d');
            devicePixelRatio != 1 
            && ctx.scale(devicePixelRatio, devicePixelRatio);
            
            ctx.fillStyle = backgroundColor || '#fff';
            ctx.rect(
                0, 0, 
                this._width * devicePixelRatio,
                this._height * devicePixelRatio
            );
            ctx.fill();
            
            //升序遍历，shape上的zlevel指定绘画图层的z轴层叠
            var shape = this.shape;
            var me = this;
            function updatePainter(shapeList, callback) {
                me.update(shapeList, callback);
            }
            this.storage.iterShape(
                function (e) {
                    if (!e.invisible) {
                        if (!e.onbrush //没有onbrush
                            //有onbrush并且调用执行返回false或undefined则继续粉刷
                            || (e.onbrush && !e.onbrush(ctx, e, false))
                        ) {
                            if (isCatchBrushException()) {
                                try {
                                    shape.get(e.shape).brush(
                                        ctx, e, false, updatePainter
                                    );
                                }
                                catch(error) {
                                    log(
                                        error,
                                        'brush error of ' + e.shape,
                                        e
                                    );
                                }
                            }
                            else {
                                shape.get(e.shape).brush(
                                    ctx, e, false, updatePainter
                                );
                            }
                        }
                    }
                },
                { normal: 'up' }
            );
            var image = imageDom.toDataURL(type, args); 
            ctx = null;
            this._domList.bg.removeChild(imageDom);
            return image;
        };

        /**
         * 获取绘图区域宽度
         */
        Painter.prototype.getWidth = function () {
            return this._width;
        };

        /**
         * 获取绘图区域高度
         */
        Painter.prototype.getHeight = function () {
            return this._height;
        };

        Painter.prototype._getWidth = function() {
            var root = this.root;
            var stl = root.currentStyle
                      || document.defaultView.getComputedStyle(root);

            // TODO: 这里有bug，如果值是小数，会出错！用parseInt可以清除尾部的px
            return root.clientWidth
                   - stl.paddingLeft.replace(/\D/g,'')   // 请原谅我这比较粗暴
                   - stl.paddingRight.replace(/\D/g,'');
        };

        Painter.prototype._getHeight = function () {
            var root = this.root;
            var stl = root.currentStyle
                      || document.defaultView.getComputedStyle(root);

            return root.clientHeight
                   - stl.paddingTop.replace(/\D/g,'')    // 请原谅我这比较粗暴
                   - stl.paddingBottom.replace(/\D/g,'');
        };

        /**
         * 检查_maxZlevel是否变大，如是则同步创建需要的Canvas
         * 
         * @private
         */
        Painter.prototype._syncMaxZlevelCanvase = function () {
            var curMaxZlevel = this.storage.getMaxZlevel();
            if (this._maxZlevel < curMaxZlevel) {
                //实体
                for (var i = this._maxZlevel + 1; i <= curMaxZlevel; i++) {
                    var canvasElem = createDom(i, 'canvas', this);
                    this._domList[i] = canvasElem;
                    this._domRoot.insertBefore(canvasElem, this._domList.hover);
                    if (vmlCanvasManager) {
                        vmlCanvasManager.initElement(canvasElem);
                    }

                    var canvasCtx = canvasElem.getContext('2d');
                    this._ctxList[i] = canvasCtx
                    if (devicePixelRatio != 1) { 
                        canvasCtx.scale(devicePixelRatio, devicePixelRatio);
                    }
                }
                this._maxZlevel = curMaxZlevel;
            }
        };

        /**
         * 刷画图形
         * 
         * @private
         * @param {Object} changedZlevel 需要更新的zlevel索引
         */
        Painter.prototype._brush = function (changedZlevel) {
            var shape = this.shape;
            var ctxList = this._ctxList;
            var me = this;
            function updatePainter(shapeList, callback) {
                me.update(shapeList, callback);
            }
            return function(e) {
                if ((changedZlevel.all || changedZlevel[e.zlevel])
                    && !e.invisible
                ) {
                    var ctx = ctxList[e.zlevel];
                    if (ctx) {
                        if (!e.onbrush //没有onbrush
                            //有onbrush并且调用执行返回false或undefined则继续粉刷
                            || (e.onbrush && !e.onbrush(ctx, e, false))
                        ) {
                            if (isCatchBrushException()) {
                                try {
                                    shape.get(e.shape).brush(
                                        ctx, e, false, updatePainter
                                    );
                                }
                                catch(error) {
                                    log(
                                        error,
                                        'brush error of ' + e.shape,
                                        e
                                    );
                                }
                            }
                            else {
                                shape.get(e.shape).brush(
                                    ctx, e, false, updatePainter
                                );
                            }
                        }
                    }
                    else {
                        log(
                            'can not find the specific zlevel canvas!'
                        );
                    }
                }
            };
        };

        /**
         * 鼠标悬浮刷画
         */
        Painter.prototype._brushHover = function (e) {
            var ctx = this._ctxList.hover;
            var me = this;
            function updatePainter(shapeList, callback) {
                me.update(shapeList, callback);
            }

            if (!e.onbrush //没有onbrush
                //有onbrush并且调用执行返回false或undefined则继续粉刷
                || (e.onbrush && !e.onbrush(ctx, e, true))
            ) {
                // Retina 优化
                if (isCatchBrushException()) {
                    try {
                        this.shape.get(e.shape).brush(ctx, e, true, updatePainter);
                    }
                    catch(error) {
                        log(
                            error, 'hoverBrush error of ' + e.shape, e
                        );
                    }
                }
                else {
                    this.shape.get(e.shape).brush(ctx, e, true, updatePainter);
                }
            }
        };

        Painter.prototype._ShapeToImage = function (
            id, e, width, height,
            canvas, ctx, devicePixelRatio
        ) {
            canvas.style.width = width + 'px';
            canvas.style.height = height + 'px';
            canvas.setAttribute('width', width * devicePixelRatio);
            canvas.setAttribute('height', height * devicePixelRatio);

            ctx.clearRect(0, 0, width * devicePixelRatio, height * devicePixelRatio);

            var brush = this.shape.get(e.shape);
            var shapeTransform = {
                position : e.position,
                rotation : e.rotation,
                scale : e.scale
            };
            e.position = [0, 0, 0];
            e.rotation = 0;
            e.scale = [1, 1];
            if (brush) {
                brush.brush(ctx, e, false);
            }

            var imgShape = {
                shape : 'image',
                id : id,
                style : {
                    x : 0,
                    y : 0,
                    // TODO 直接使用canvas而不是通过base64
                    image : canvas.toDataURL()
                }
            }

            if (typeof shapeTransform.position !== 'undefined') {
                imgShape.position = e.position = shapeTransform.position;
            }

            if (typeof shapeTransform.rotation !== 'undefined') {
                imgShape.rotation = e.rotation = shapeTransform.rotation;
            }

            if (typeof shapeTransform.scale !== 'undefined') {
                imgShape.scale = e.scale = shapeTransform.scale;
            }

            return imgShape;
        };

        Painter.prototype._createShapeToImageProcessor = function () {
            if (vmlCanvasManager) {
                return doNothing;
            }

            var painter = this;
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');
            var devicePixelRatio = window.devicePixelRatio || 1;
            
            return function (id, e, width, height) {
                painter._ShapeToImage(
                    id, e, width, height,
                    canvas, ctx, devicePixelRatio
                );
            };
        };

        /**
         * 创建dom
         * 
         * @inner
         * @param {string} id dom id 待用
         * @param {string} type dom type，such as canvas, div etc.
         * @param {Painter} painter painter instance
         */
        function createDom(id, type, painter) {
            var newDom = document.createElement(type);
            var width = painter._width;
            var height = painter._height;

            // 没append呢，请原谅我这样写，清晰~
            newDom.style.position = 'absolute';
            newDom.style.left = 0;
            newDom.style.top = 0;
            newDom.style.width = width + 'px';
            newDom.style.height = height + 'px';
            newDom.setAttribute('width', width * devicePixelRatio);
            newDom.setAttribute('height', height * devicePixelRatio);

            //id不作为索引用，避免可能造成的重名，定义为私有属性
            newDom.setAttribute('data-id', id);
            return newDom;
        }

        return Painter;
    }
);