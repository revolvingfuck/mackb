//=============================================================================
// PixelMovement.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Enables smooth pixel-by-pixel movement instead of grid-based
 * @author Claude Code
 * @url https://github.com/anthropics/claude-code
 *
 * @help PixelMovement.js
 *
 * This plugin enables pixel-perfect movement, allowing characters to move
 * smoothly without being locked to the tile grid.
 *
 * @param enablePixelMovement
 * @text Enable Pixel Movement
 * @type boolean
 * @default true
 * @desc Enable pixel-perfect movement for characters
 *
 * @param pixelMoveSpeed
 * @text Pixel Move Speed
 * @type number
 * @decimals 2
 * @min 0.5
 * @max 10.0
 * @default 4.0
 * @desc Base movement speed in pixels per frame
 */

(() => {
    'use strict';

    const pluginName = 'PixelMovement';
    const parameters = PluginManager.parameters(pluginName);
    const enablePixelMovement = parameters['enablePixelMovement'] === 'true';
    const pixelMoveSpeed = Number(parameters['pixelMoveSpeed']) || 4.0;

    //-----------------------------------------------------------------------------
    // Game_CharacterBase
    //-----------------------------------------------------------------------------

    const _Game_CharacterBase_initMembers = Game_CharacterBase.prototype.initMembers;
    Game_CharacterBase.prototype.initMembers = function() {
        _Game_CharacterBase_initMembers.call(this);
        this._pixelX = 0;
        this._pixelY = 0;
    };

    Game_CharacterBase.prototype.usePixelMovement = function() {
        return enablePixelMovement;
    };

    const _Game_CharacterBase_distancePerFrame = Game_CharacterBase.prototype.distancePerFrame;
    Game_CharacterBase.prototype.distancePerFrame = function() {
        if (this.usePixelMovement()) {
            // Convert speed to fraction of a tile per frame
            return pixelMoveSpeed / $gameMap.tileWidth();
        }
        return _Game_CharacterBase_distancePerFrame.call(this);
    };

    const _Game_CharacterBase_realMoveSpeed = Game_CharacterBase.prototype.realMoveSpeed;
    Game_CharacterBase.prototype.realMoveSpeed = function() {
        if (this.usePixelMovement()) {
            return pixelMoveSpeed;
        }
        return _Game_CharacterBase_realMoveSpeed.call(this);
    };

    const _Game_CharacterBase_isMoving = Game_CharacterBase.prototype.isMoving;
    Game_CharacterBase.prototype.isMoving = function() {
        if (this.usePixelMovement()) {
            return this._realX !== this._x || this._realY !== this._y;
        }
        return _Game_CharacterBase_isMoving.call(this);
    };

    //-----------------------------------------------------------------------------
    // Game_Player
    //-----------------------------------------------------------------------------

    const _Game_Player_updateMove = Game_Player.prototype.updateMove;
    Game_Player.prototype.updateMove = function() {
        if (this.usePixelMovement()) {
            // Custom pixel movement update
            this.updatePixelMove();
        } else {
            _Game_Player_updateMove.call(this);
        }
    };

    Game_Player.prototype.updatePixelMove = function() {
        const direction = this.direction();
        const distance = this.distancePerFrame();

        if (direction === 2) { // Down
            this._realY = Math.min(this._realY + distance, this._y + 1);
        } else if (direction === 4) { // Left
            this._realX = Math.max(this._realX - distance, this._x - 1);
        } else if (direction === 6) { // Right
            this._realX = Math.min(this._realX + distance, this._x + 1);
        } else if (direction === 8) { // Up
            this._realY = Math.max(this._realY - distance, this._y - 1);
        }

        // Update position when reaching tile boundary
        if (this._realX <= this._x - 1) {
            this._x--;
            this._realX = this._x;
        } else if (this._realX >= this._x + 1) {
            this._x++;
            this._realX = this._x;
        }

        if (this._realY <= this._y - 1) {
            this._y--;
            this._realY = this._y;
        } else if (this._realY >= this._y + 1) {
            this._y++;
            this._realY = this._y;
        }
    };

})();
