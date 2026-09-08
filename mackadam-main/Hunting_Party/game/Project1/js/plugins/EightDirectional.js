//=============================================================================
// EightDirectional.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Enables 8-directional movement and sprite animations
 * @author Claude Code
 * @url https://github.com/anthropics/claude-code
 *
 * @help EightDirectional.js
 *
 * This plugin adds 8-directional movement controls and sprite animations.
 *
 * Sprite Sheet Row Layout (top to bottom):
 * Row 0: Down-Left
 * Row 1: Down
 * Row 2: Down-Right
 * Row 3: Left
 * Row 4: Right
 * Row 5: Up-Left
 * Row 6: Up
 * Row 7: Up-Right
 *
 * @param enableDiagonalMovement
 * @text Enable Diagonal Movement
 * @type boolean
 * @default true
 * @desc Enable 8-directional movement
 *
 * @param diagonalSpeed
 * @text Diagonal Speed Multiplier
 * @type number
 * @decimals 2
 * @min 0.50
 * @max 1.00
 * @default 0.71
 * @desc Speed multiplier for diagonal movement (0.71 ≈ 1/√2)
 */

(() => {
    'use strict';

    const pluginName = 'EightDirectional';
    const parameters = PluginManager.parameters(pluginName);
    const enableDiagonalMovement = parameters['enableDiagonalMovement'] === 'true';
    const diagonalSpeed = Number(parameters['diagonalSpeed']) || 0.71;

    // Direction constants for 8 directions
    const DIR_DOWN = 2;
    const DIR_LEFT = 4;
    const DIR_RIGHT = 6;
    const DIR_UP = 8;
    const DIR_DOWN_LEFT = 1;
    const DIR_UP_LEFT = 7;
    const DIR_UP_RIGHT = 9;
    const DIR_DOWN_RIGHT = 3;

    //-----------------------------------------------------------------------------
    // Game_CharacterBase
    //-----------------------------------------------------------------------------

    const _Game_CharacterBase_initMembers = Game_CharacterBase.prototype.initMembers;
    Game_CharacterBase.prototype.initMembers = function() {
        _Game_CharacterBase_initMembers.call(this);
        this._diagonal = false;
    };

    Game_CharacterBase.prototype.isDiagonal = function() {
        return this._diagonal;
    };

    Game_CharacterBase.prototype.use8Direction = function() {
        return enableDiagonalMovement;
    };

    const _Game_CharacterBase_setDirection = Game_CharacterBase.prototype.setDirection;
    Game_CharacterBase.prototype.setDirection = function(d) {
        if (!this.isDirectionFixed() && this.use8Direction()) {
            this._direction = d;
            this._diagonal = [DIR_DOWN_LEFT, DIR_UP_LEFT, DIR_UP_RIGHT, DIR_DOWN_RIGHT].includes(d);
        } else {
            _Game_CharacterBase_setDirection.call(this, d);
        }
        this.resetStopCount();
    };

    // Convert 8-direction to sprite sheet row
    Game_CharacterBase.prototype.directionToRow = function(d) {
        if (!this.use8Direction()) {
            // Standard 4-direction mapping
            return (d - 2) / 2;
        }

        const dirMap = {
            1: 0,  // Down-Left
            2: 1,  // Down
            3: 2,  // Down-Right
            4: 3,  // Left
            6: 4,  // Right
            7: 5,  // Up-Left
            8: 6,  // Up
            9: 7   // Up-Right
        };
        return dirMap[d] !== undefined ? dirMap[d] : 1;
    };

    const _Game_CharacterBase_characterPatternY = Game_CharacterBase.prototype.characterPatternY;
    Game_CharacterBase.prototype.characterPatternY = function() {
        if (this.use8Direction()) {
            return this.directionToRow(this._direction);
        }
        return _Game_CharacterBase_characterPatternY.call(this);
    };

    const _Game_CharacterBase_realMoveSpeed = Game_CharacterBase.prototype.realMoveSpeed;
    Game_CharacterBase.prototype.realMoveSpeed = function() {
        const baseSpeed = _Game_CharacterBase_realMoveSpeed.call(this);
        if (this.isDiagonal() && this.use8Direction()) {
            return baseSpeed * diagonalSpeed;
        }
        return baseSpeed;
    };

    //-----------------------------------------------------------------------------
    // Game_Character
    //-----------------------------------------------------------------------------

    Game_Character.prototype.moveDiagonally = function(horz, vert) {
        if (!this.use8Direction()) return;

        const diag = this.getDiagonalDirection(horz, vert);
        if (diag) {
            this.setMovementSuccess(this.canPassDiagonally(this._x, this._y, horz, vert));
            if (this.isMovementSucceeded()) {
                this._x = $gameMap.roundXWithDirection(this._x, horz);
                this._y = $gameMap.roundYWithDirection(this._y, vert);
                this._realX = $gameMap.xWithDirection(this._x, this.reverseDir(horz));
                this._realY = $gameMap.yWithDirection(this._y, this.reverseDir(vert));
                this.increaseSteps();
                this.setDirection(diag);
            }
        }
    };

    Game_Character.prototype.getDiagonalDirection = function(horz, vert) {
        if (horz === DIR_LEFT && vert === DIR_DOWN) return DIR_DOWN_LEFT;
        if (horz === DIR_LEFT && vert === DIR_UP) return DIR_UP_LEFT;
        if (horz === DIR_RIGHT && vert === DIR_UP) return DIR_UP_RIGHT;
        if (horz === DIR_RIGHT && vert === DIR_DOWN) return DIR_DOWN_RIGHT;
        return 0;
    };

    //-----------------------------------------------------------------------------
    // Game_Player
    //-----------------------------------------------------------------------------

    const _Game_Player_moveByInput = Game_Player.prototype.moveByInput;
    Game_Player.prototype.moveByInput = function() {
        if (!this.isMoving() && this.canMove() && enableDiagonalMovement) {
            let direction = this.getInputDirection();
            if (direction > 0) {
                $gameTemp.clearDestination();
            } else if ($gameTemp.isDestinationValid()) {
                const x = $gameTemp.destinationX();
                const y = $gameTemp.destinationY();
                direction = this.findDirectionTo(x, y);
            }
            if (direction > 0) {
                this.executeMove(direction);
            }
        } else {
            _Game_Player_moveByInput.call(this);
        }
    };

    Game_Player.prototype.getInputDirection = function() {
        return enableDiagonalMovement ? Input.dir8 : Input.dir4;
    };

    Game_Player.prototype.executeMove = function(d) {
        if ([DIR_DOWN_LEFT, DIR_UP_LEFT, DIR_UP_RIGHT, DIR_DOWN_RIGHT].includes(d)) {
            const horz = [DIR_DOWN_LEFT, DIR_UP_LEFT].includes(d) ? DIR_LEFT : DIR_RIGHT;
            const vert = [DIR_UP_LEFT, DIR_UP_RIGHT].includes(d) ? DIR_UP : DIR_DOWN;
            this.moveDiagonally(horz, vert);
        } else {
            this.moveStraight(d);
        }
    };

    //-----------------------------------------------------------------------------
    // Input
    //-----------------------------------------------------------------------------

    Object.defineProperty(Input, 'dir8', {
        get: function() {
            const left = this.isPressed('left');
            const right = this.isPressed('right');
            const up = this.isPressed('up');
            const down = this.isPressed('down');

            // Check diagonal combinations first
            if (down && left) return DIR_DOWN_LEFT;
            if (down && right) return DIR_DOWN_RIGHT;
            if (up && left) return DIR_UP_LEFT;
            if (up && right) return DIR_UP_RIGHT;

            // Fall back to cardinal directions
            return this.dir4;
        },
        configurable: true
    });

})();
