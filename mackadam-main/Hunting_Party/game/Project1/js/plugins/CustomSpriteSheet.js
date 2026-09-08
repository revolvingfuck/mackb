//=============================================================================
// CustomSpriteSheet.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Handles custom sprite sheet dimensions with spacing
 * @author Claude Code
 * @url https://github.com/anthropics/claude-code
 *
 * @help CustomSpriteSheet.js
 *
 * This plugin configures sprite rendering for custom sprite sheets
 * with non-standard dimensions and spacing between frames.
 *
 * Sprite Sheet Layout:
 * - Total size: 1536x2752 pixels
 * - 8 frames horizontal x 8 rows vertical
 * - 25px padding on left and right
 * - 90px spacing between columns
 * - 70px spacing between rows
 * - No padding on top/bottom
 *
 * @param frameWidth
 * @text Frame Width
 * @type number
 * @default 107
 * @desc Width of each sprite frame in pixels
 *
 * @param frameHeight
 * @text Frame Height
 * @type number
 * @default 283
 * @desc Height of each sprite frame in pixels
 *
 * @param paddingLeft
 * @text Left Padding
 * @type number
 * @default 25
 * @desc Left edge padding in pixels
 *
 * @param spacingHorizontal
 * @text Horizontal Spacing
 * @type number
 * @default 90
 * @desc Space between columns in pixels
 *
 * @param spacingVertical
 * @text Vertical Spacing
 * @type number
 * @default 70
 * @desc Space between rows in pixels
 *
 * @param framesPerRow
 * @text Frames Per Row
 * @type number
 * @default 8
 * @desc Number of animation frames per row
 *
 * @param totalRows
 * @text Total Rows
 * @type number
 * @default 8
 * @desc Total number of rows in sprite sheet
 */

(() => {
    'use strict';

    const pluginName = 'CustomSpriteSheet';
    const parameters = PluginManager.parameters(pluginName);

    const frameWidth = Number(parameters['frameWidth']) || 107;
    const frameHeight = Number(parameters['frameHeight']) || 283;
    const paddingLeft = Number(parameters['paddingLeft']) || 25;
    const spacingHorizontal = Number(parameters['spacingHorizontal']) || 90;
    const spacingVertical = Number(parameters['spacingVertical']) || 70;
    const framesPerRow = Number(parameters['framesPerRow']) || 8;
    const totalRows = Number(parameters['totalRows']) || 8;

    //-----------------------------------------------------------------------------
    // Game_CharacterBase
    //-----------------------------------------------------------------------------

    Game_CharacterBase.prototype.useCustomSpriteSheet = function() {
        // You can add logic here to determine which characters use custom sheets
        // For now, apply to all characters
        return true;
    };

    const _Game_CharacterBase_maxPattern = Game_CharacterBase.prototype.maxPattern;
    Game_CharacterBase.prototype.maxPattern = function() {
        if (this.useCustomSpriteSheet()) {
            return framesPerRow;
        }
        return _Game_CharacterBase_maxPattern.call(this);
    };

    const _Game_CharacterBase_pattern = Game_CharacterBase.prototype.pattern;
    Game_CharacterBase.prototype.pattern = function() {
        if (this.useCustomSpriteSheet()) {
            return this._pattern < framesPerRow ? this._pattern : 0;
        }
        return _Game_CharacterBase_pattern.call(this);
    };

    //-----------------------------------------------------------------------------
    // Sprite_Character
    //-----------------------------------------------------------------------------

    const _Sprite_Character_patternWidth = Sprite_Character.prototype.patternWidth;
    Sprite_Character.prototype.patternWidth = function() {
        if (this._character && this._character.useCustomSpriteSheet()) {
            return frameWidth;
        }
        return _Sprite_Character_patternWidth.call(this);
    };

    const _Sprite_Character_patternHeight = Sprite_Character.prototype.patternHeight;
    Sprite_Character.prototype.patternHeight = function() {
        if (this._character && this._character.useCustomSpriteSheet()) {
            return frameHeight;
        }
        return _Sprite_Character_patternHeight.call(this);
    };

    const _Sprite_Character_characterPatternX = Sprite_Character.prototype.characterPatternX;
    Sprite_Character.prototype.characterPatternX = function() {
        if (this._character && this._character.useCustomSpriteSheet()) {
            const frameIndex = this._character.pattern();
            return paddingLeft + frameIndex * (frameWidth + spacingHorizontal);
        }
        return _Sprite_Character_characterPatternX.call(this);
    };

    const _Sprite_Character_characterPatternY = Sprite_Character.prototype.characterPatternY;
    Sprite_Character.prototype.characterPatternY = function() {
        if (this._character && this._character.useCustomSpriteSheet()) {
            const rowIndex = this._character.characterPatternY();
            return rowIndex * (frameHeight + spacingVertical);
        }
        return _Sprite_Character_characterPatternY.call(this);
    };

    const _Sprite_Character_updateCharacterFrame = Sprite_Character.prototype.updateCharacterFrame;
    Sprite_Character.prototype.updateCharacterFrame = function() {
        if (this._character && this._character.useCustomSpriteSheet()) {
            const pw = this.patternWidth();
            const ph = this.patternHeight();
            const sx = this.characterPatternX();
            const sy = this.characterPatternY();
            this.setFrame(sx, sy, pw, ph);
        } else {
            _Sprite_Character_updateCharacterFrame.call(this);
        }
    };

})();
