# HEARTCORE - Godot 4.5 Prototype Implementation Plan

## Mission Statement
Build a production-ready prototype demonstrating the core hybrid control system mechanics of HEARTCORE as specified in the design documents. This is NOT a proof-of-concept or tutorial example—this is the foundation of a shippable game system.

---

## Core Systems Overview

### 1. HEART System (Volatility)
**Purpose**: Hidden value that modulates timing, reliability, and system friction
**Implementation Approach**:
- Global singleton `HeartSystem` (AutoLoad)
- Float value `volatility` (0.0 - 1.0+)
- Affects multiple subsystems through modulation formulas
- NO UI display—purely mechanical influence
- Triggers based on:
  - Combat stress (taking damage, witnessing party harm)
  - Berserker state activation
  - Failed defensive actions
  - Time under threat
- Recovery based on:
  - Successful party coordination
  - Aya's stabilization abilities
  - Core progression milestones
  - Time out of combat

### 2. CORE System (Commitment/Synchronization)
**Purpose**: Progression gates that unlock behavioral overrides and reduce friction
**Implementation Approach**:
- Global singleton `CoreSystem` (AutoLoad)
- Integer progression levels (0-10)
- Each level unlocks specific behavioral changes:
  - Reduced hesitation penalties on party commands
  - Simultaneous action windows
  - Volatility cascade suppression
  - Trust buffer multipliers
- Advanced through narrative events and choices (for prototype: manual triggers)

### 3. TRUST System (Per-Character Relationship)
**Purpose**: Modulates command latency and reliability for Aya and Eli
**Implementation Approach**:
- Character resource `CharacterTrustData` extends Resource
- Float value `trust_level` (0.0 - 1.0) per party member
- Affects:
  - ABS fill rate multiplier
  - Command execution delay
  - Pre-buffering allowance
  - Refusal probability (low trust = higher chance)
- Modified by:
  - Successful coordinated actions
  - Dialogue choices (not in prototype)
  - Protecting party members
  - Using characters effectively

### 4. ABS System (Action Battle Speed / Active Time Battle)
**Purpose**: Command availability meter for Aya and Eli
**Implementation Approach**:
- Per-character float value `abs_charge` (0.0 - 100.0)
- Fill rate formula (from design doc):
  ```
  fill_rate = base_recovery × healing_progression × trust × emotional_clarity ÷ heart_volatility
  ```
- Prototype simplified formula:
  ```
  fill_rate = base_recovery × (1.0 + trust) × emotional_clarity ÷ (1.0 + volatility)
  ```
- When full: character can execute commands
- Commands consume charge and execute based on trust/volatility

### 5. STEALTH & DETECTION System (Early Game Core Mechanic)
**Purpose**: Mechanize "survive by hiding" → "stand and fight together" progression arc
**Implementation Approach**:
- Early game (Low Core): Stealth is the PRIMARY gameplay mode
- Late game (High Core): Direct confrontation becomes viable
- System bridges exploration and combat

**Detection Mechanics**:
- Enemy `DetectionRange` areas (vision cones, hearing radius)
- Three alert states:
  - **Unaware**: Default patrol behavior
  - **Suspicious**: Detected movement/noise, investigating
  - **Alert**: Party spotted, engaging in combat
- Detection accumulation over time (not instant)
- Line of sight checks + occlusion
- Noise generation from:
  - Movement speed (running vs walking)
  - Combat actions
  - Party member panic (high volatility = more noise)

**Stealth Mechanics for Party**:
- **Crouch/Sneak toggle**: Reduces movement speed, lowers detection radius
- **Cover system**: Designated cover objects break line of sight
- **Party cohesion penalties**:
  - Low trust = Aya/Eli lag behind, increase detection risk
  - High volatility = party moves less predictably, more visible
- **Environmental interactions**:
  - Distraction objects (throw to redirect patrols)
  - Hide spots (temporary safe zones)

**Volatility Integration**:
- High volatility increases detection rate:
  - Party moves more erratically
  - Noise penalty multiplier
  - Detection accumulates faster
- Being detected spikes volatility (fear feedback loop)
- Successful stealth reduces volatility over time

**Core Progression Impact**:
- **Core 0-3** (Early Game):
  - Combat extremely risky (high volatility + unreliable commands)
  - Stealth strongly encouraged mechanically
  - Detection → high probability of party wipe
- **Core 4-7** (Mid Game):
  - Mixed approach viable
  - Combat manageable if prepared
  - Stealth optional but beneficial
- **Core 8-10** (Late Game):
  - Direct confrontation earned
  - Stealth still useful tactically
  - Party synchronization makes combat preferred

**Combat Initiation States**:
- **Ambush** (party undetected, initiates combat): Bonus trust gain, reduced initial volatility
- **Detected** (enemy initiates): Standard combat start
- **Caught** (detected while fleeing): Volatility spike, ABS meters start empty, party hesitation penalty

**Technical Implementation**:
- `DetectionSystem` singleton (AutoLoad)
- Per-enemy `EnemyDetectionComponent`:
  - Vision cone (Area3D with CollisionShape3D)
  - Hearing radius (Area3D sphere)
  - Alert state machine (Unaware → Suspicious → Alert)
  - Detection accumulator (0.0 - 1.0, triggers at threshold)
- `PartyStealthController`:
  - Sneak state toggle
  - Noise emission calculation
  - Cover state tracking
- Integration with HeartSystem and CoreSystem for modulation

**UI Feedback**:
- Subtle detection indicator (fills as enemies detect party)
- Enemy alert icons above heads (? for suspicious, ! for alert)
- No minimap radar (too gamey for design intent)
- Audio cues: enemy callouts, footsteps, heartbeat when near detection

---

## Character Control Systems

### 6. Luto - Direct Control System
**Control Type**: Real-time action controller (CharacterBody3D or 2D)
**Core Features**:
- Direct movement (WASD/Left Stick)
- Dodge/Roll with i-frames
- Light attack combo chain
- Heavy attack (commitment action)
- **State Machine**:
  - **Normal**: Default responsive state
  - **Berserker**: Triggered by chaining attacks under high volatility
    - Faster attack speed
    - Reduced recovery frames
    - Dodge becomes unsafe (no i-frames, commits further)
    - Party ABS fill rates reduced (desynchronization)
    - Exit condition: Time elapsed OR successful Aya stabilization
  - **Paralysis**: Triggered by failed dodges, taking damage, witnessing party harm
    - Input delay (buffered inputs execute later)
    - Cancel windows shrink
    - Camera zoom tightens
    - ABS meters stall/decay
    - Exit condition: Time elapsed OR Aya intervention

**Technical Implementation**:
- `LutoController` script on CharacterBody3D
- `LutoStateMachine` managing Normal/Berserker/Paralysis
- Input buffering system (2-4 frame window)
- AnimationTree with state machine for combat animations
- Signals emitted for party synchronization events
- Sneak toggle integration with PartyStealthController

### 7. Aya - Command-Based Control System
**Control Type**: Command menu selection (turn-based style)
**Core Features**:
- **Commands**:
  - Heal (First Aid): Single target HP restoration
  - Stabilize: Reduces Heart volatility, interrupts Luto's Paralysis
  - Performance Buff: Temporary boost to party (increased trust effectiveness)
  - Chant/Song: AoE support effects
- **Trust Mechanics**:
  - Low trust + High volatility = Delays, weaker effects, occasional refusals
  - High trust = Pre-buffered actions, partial auto-casting, interrupts Luto's fear responses
- **ABS Integration**:
  - Commands only available when ABS full
  - Execution timing varies with trust/volatility
  - Visual feedback: hesitation animations at low trust

**Technical Implementation**:
- `AyaController` script managing command queue
- `CommandExecutor` processes commands with delay/reliability checks
- UI: `AyaCommandMenu` (Control node tree)
- Resource: `AyaCommandResource` for each ability
- Signals to HeartSystem for stabilization effects

### 8. Eli - Concept Art Magic System
**Control Type**: Command menu with concept selection
**Core Features**:
- **Painting Mechanic**:
  - Select emotional concept from menu (Rage, Fear, Hope, Protection)
  - Concept manifests as visual spell effect
  - Casting time varies with emotional state
- **Emotional States**:
  - Overwhelmed: Concepts fuzz/misfire, increased cast time
  - Aligned: Fast casting, reduced ABS cost, spell variants
- **Blue Magic** (prototype: simplified):
  - Observe enemy abilities
  - Replicate through concept painting
- **Trauma Reversal** (late game mechanic—not in initial prototype)

**Technical Implementation**:
- `EliController` script managing concept queue
- `ConceptSpellSystem` translates concepts to spell effects
- UI: `EliConceptMenu` (Control node tree)
- Resource: `ConceptSpellResource` for each concept
- Emotional state tracked separately from Heart volatility

---

## Prototype Scope Definition

### What MUST Be Included:
1. **Playable Luto**:
   - Movement, dodge, light/heavy attacks
   - Sneak toggle (reduced speed, lower detection)
   - Berserker and Paralysis state transitions
   - Input buffering
   - Volatility influence on responsiveness

2. **Commandable Aya**:
   - ABS meter filling based on formula
   - Command menu (Heal, Stabilize, Buff)
   - Trust-based execution delays
   - Hesitation/refusal at low trust
   - Follow behavior with trust-based cohesion

3. **Commandable Eli**:
   - ABS meter filling based on formula
   - Concept selection menu
   - Emotional state affecting cast time
   - Basic offensive spells
   - Follow behavior with trust-based cohesion

4. **Global Systems**:
   - Heart/Volatility tracking and modulation
   - Core progression (manual level setting for testing)
   - Trust tracking per character
   - Detection/Stealth state tracking
   - Signal-based event architecture

5. **Stealth System**:
   - Enemy detection (vision cones, hearing radius)
   - Alert states (Unaware → Suspicious → Alert)
   - Party noise generation (affected by volatility, movement speed)
   - Cover objects and hide spots
   - Detection accumulation over time
   - Combat initiation states (Ambush vs Detected vs Caught)

6. **Combat Encounter**:
   - Enemy AI with patrol and detection
   - Damage dealing and receiving
   - State triggers (volatility spike on damage/detection)
   - Victory/defeat conditions
   - Stealth → combat transitions

7. **UI Layer**:
   - ABS meters for Aya/Eli (visual bars, NO numbers—design intent)
   - Command menus
   - Detection indicator (subtle fill bar)
   - Enemy alert icons (? and ! above heads)
   - Subtle volatility indicators (screen shake, vignette)
   - Health bars

### What Can Be Deferred (Post-Prototype):
- Full narrative integration
- Trauma Incarnate boss mechanics
- Eli's Blue Magic mimicry
- Complex combo systems
- Full animation sets (placeholder animations acceptable initially)
- Multiplayer/networking
- Save/load system
- Full character customization

---

## Architecture and File Structure

### Autoload Singletons:
```
res://autoload/
├── heart_system.gd          # Volatility tracking and modulation
├── core_system.gd           # Progression and synchronization gates
├── detection_system.gd      # Global stealth/detection state tracking
├── event_bus.gd             # Signal bus for decoupled communication
└── game_manager.gd          # Scene management, combat state
```

### Character Systems:
```
res://characters/
├── luto/
│   ├── luto.tscn                    # CharacterBody3D scene
│   ├── luto_controller.gd           # Direct control input handler
│   ├── luto_state_machine.gd        # Normal/Berserker/Paralysis
│   ├── luto_combat.gd               # Attack execution, hitboxes
│   └── animations/
│       └── luto_animation_tree.tscn # AnimationTree with state machine
├── aya/
│   ├── aya.tscn                     # CharacterBody3D (AI-controlled positioning)
│   ├── aya_controller.gd            # Command processing
│   ├── aya_command_executor.gd      # Trust/volatility-based execution
│   └── resources/
│       └── aya_commands.tres        # Resource collection of commands
├── eli/
│   ├── eli.tscn
│   ├── eli_controller.gd
│   ├── eli_concept_system.gd        # Concept → Spell translation
│   └── resources/
│       └── eli_concepts.tres
└── party/
    ├── party_stealth_controller.gd  # Sneak state, noise calculation
    ├── party_formation.gd           # Cohesion, follow behavior
    └── party_manager.gd             # Coordinates all party members
```

### Resources (Data-Driven):
```
res://resources/
├── character_data/
│   ├── character_trust_data.gd      # Base trust resource
│   ├── aya_trust.tres
│   └── eli_trust.tres
├── abilities/
│   ├── ability_base.gd              # Base ability resource
│   ├── aya_abilities/
│   │   ├── heal.tres
│   │   ├── stabilize.tres
│   │   └── buff.tres
│   └── eli_abilities/
│       ├── rage_concept.tres
│       └── fear_concept.tres
└── formulas/
    └── abs_formula.gd               # Centralized formula calculations
```

### UI:
```
res://ui/
├── hud/
│   ├── hud.tscn                     # Main HUD container
│   ├── abs_meter.tscn               # Reusable ABS meter component
│   ├── health_bar.tscn
│   └── volatility_effects.tscn      # Screen effects (shake, vignette)
├── menus/
│   ├── aya_command_menu.tscn
│   └── eli_concept_menu.tscn
└── ui_controller.gd                 # Manages menu state, input routing
```

### Combat/Enemies:
```
res://combat/
├── enemies/
│   ├── cyborg_grunt.tscn
│   ├── cyborg_grunt_ai.gd
│   ├── enemy_detection_component.gd # Vision cone, hearing, alert states
│   └── enemy_patrol.gd              # Patrol path behavior
├── damage_system.gd                 # Damage calculation, application
└── combat_manager.gd                # Encounter state, win/loss
```

### Stealth/Environment:
```
res://stealth/
├── cover_object.tscn                # Cover points that break LOS
├── hide_spot.tscn                   # Temporary safe zones
├── distraction_object.tscn          # Throwable distraction
├── detection_volume.gd              # Base class for vision/hearing
└── stealth_helpers.gd               # LOS checks, noise calculations
```

### Scenes:
```
res://scenes/
├── prototype_stealth_city.tscn      # City environment with patrols (early game)
├── prototype_battle.tscn            # Direct combat test scene (late game)
└── testing/
    └── system_test_scenes/          # Individual system tests
```

---

## Implementation Phases

### Phase 1: Foundation (Core Systems & Singletons)
**Goal**: Establish signal architecture and global state systems

**Tasks**:
1. Create AutoLoad singletons:
   - HeartSystem: Volatility tracking, getter/setter, modulation functions
   - CoreSystem: Level tracking, gate checking functions
   - DetectionSystem: Global detection state tracking (stub for Phase 3)
   - EventBus: Centralized signal definitions
   - GameManager: Basic scene/state management

2. Define signal contracts in EventBus:
   ```gdscript
   # Core systems
   signal volatility_changed(new_value: float)
   signal core_advanced(new_level: int)
   signal trust_changed(character_name: String, new_trust: float)

   # Combat
   signal damage_taken(character_name: String, amount: float)
   signal party_action_coordinated(success: bool)
   signal combat_initiated(initiation_type: String)  # "ambush", "detected", "caught"

   # Stealth/Detection
   signal detection_changed(detection_level: float)  # 0.0-1.0
   signal enemy_alert_state_changed(enemy: Node, new_state: String)  # "unaware", "suspicious", "alert"
   signal party_detected()
   signal party_entered_cover()
   signal party_exited_cover()
   ```

3. Create base Resource classes:
   - CharacterTrustData
   - AbilityBase
   - ConceptSpell

4. Build ABS formula calculator utility

**Definition of Done**:
- All singletons accessible via AutoLoad
- Signal emission and connection tested
- Resource templates created
- Formula calculator produces correct values with test inputs

---

### Phase 2: Luto Direct Control
**Goal**: Playable character with full movement and state machine

**Tasks**:
1. Create Luto CharacterBody3D scene with placeholder mesh
2. Implement LutoController:
   - Movement (8-directional or analog)
   - Dodge/roll with i-frame detection
   - Attack input detection
3. Implement LutoStateMachine:
   - State enum and current_state tracking
   - Normal state: Default behavior
   - Berserker state: Triggered by attack chaining under volatility
   - Paralysis state: Triggered by damage/failure
   - Transition conditions with cooldowns
4. Create AnimationTree with blend states
5. Integrate input buffering (2-4 frame window)
6. Connect to HeartSystem:
   - Volatility affects input delay
   - State changes emit signals

**Definition of Done**:
- Luto moves and attacks responsively
- State transitions occur based on conditions
- Input buffering prevents dropped inputs
- Volatility visibly affects responsiveness
- Berserker state changes attack timing
- Paralysis state delays inputs

---

### Phase 3: Stealth & Detection System
**Goal**: Enemy detection and party stealth mechanics that embody early-game "survive by hiding"

**Tasks**:
1. Create DetectionSystem singleton:
   - Global detection state tracking
   - Noise calculation utilities
   - LOS helper functions
2. Implement EnemyDetectionComponent:
   - Vision cone (Area3D with cone-shaped CollisionShape3D)
   - Hearing radius (Area3D sphere)
   - Alert state machine (Unaware → Suspicious → Alert)
   - Detection accumulator (fills over time when party in range)
   - Signal emissions for state changes
3. Implement PartyStealthController:
   - Sneak toggle (affects Luto movement speed)
   - Noise emission calculation (based on movement speed + volatility)
   - Cover state detection (raycasts to cover objects)
   - Integration with HeartSystem (volatility increases noise)
4. Create environmental objects:
   - CoverObject (breaks LOS)
   - HideSpot (temporary safe zone)
   - DistractionObject (throwable to redirect patrols)
5. Implement enemy patrol behavior:
   - Waypoint-based patrol paths
   - Investigation behavior when Suspicious
   - Chase behavior when Alert
6. Create city test scene:
   - Simple urban environment
   - 2-3 patrolling enemies
   - Cover objects and hide spots
   - Goal: reach destination without detection

**Definition of Done**:
- Enemy vision cones detect party in LOS
- Detection accumulates over time, triggers alert
- Sneak mode reduces detection range
- High volatility increases detection rate
- Alert enemies transition to combat
- Party can use cover to break LOS
- Detection UI indicator shows accumulation
- Alert icons appear above enemy heads

---

### Phase 4: Aya Command System
**Goal**: Command-based party member with trust-modulated execution

**Tasks**:
1. Create Aya CharacterBody3D scene (AI follows Luto for positioning)
2. Implement AyaController:
   - ABS meter charging using formula
   - Command queue processing
3. Create AyaCommandExecutor:
   - Trust-based delay calculation
   - Refusal probability at low trust
   - Effect application (heal, stabilize)
4. Build UI AyaCommandMenu:
   - Button layout for commands
   - ABS meter visual representation
   - Input routing when menu open
5. Create command resources (Heal, Stabilize, Buff)
6. Connect to HeartSystem:
   - Stabilize reduces volatility
   - High volatility slows ABS fill

**Definition of Done**:
- Aya's ABS meter fills according to formula
- Command menu opens and accepts input
- Commands execute with trust-based delay
- Low trust shows hesitation (delay + animation)
- Heal restores Luto's HP
- Stabilize reduces volatility and exits Paralysis
- Buff provides temporary effect

---

### Phase 5: Eli Concept System
**Goal**: Art-based magic with emotional state modulation

**Tasks**:
1. Create Eli CharacterBody3D scene (AI follows party)
2. Implement EliController:
   - ABS meter charging
   - Concept queue processing
3. Create EliConceptSystem:
   - Emotional state tracking (separate from Heart)
   - Concept → Spell translation
   - Cast time modulation based on state
4. Build UI EliConceptMenu:
   - Concept selection interface
   - ABS meter display
5. Create concept spell resources:
   - Rage (offensive damage)
   - Fear (enemy debuff)
   - Hope (party buff)
   - Protection (shield/barrier)
6. Implement visual spell effects (simple particles)

**Definition of Done**:
- Eli's ABS meter fills according to formula
- Concept menu opens and accepts selection
- Spells cast with emotional state affecting speed
- Visual feedback differentiates concepts
- Damage/effects apply correctly

---

### Phase 6: Combat Integration & Stealth-to-Combat Transitions
**Goal**: Enemy combat AI, damage loop, and seamless stealth-to-combat flow

**Tasks**:
1. Update cyborg grunt enemy (already has detection from Phase 3):
   - Add combat AI state (approach, attack, retreat)
   - Health tracking
   - Transition from Alert state to Combat state
2. Implement DamageSystem:
   - Damage calculation
   - Hit detection and application
   - Death handling
3. Connect damage to volatility:
   - Luto taking damage → volatility spike
   - Party member taking damage → larger spike
   - Successful dodge → volatility reduction
   - Being detected → volatility spike
4. Implement combat initiation states:
   - **Ambush**: Party initiates while undetected
     - Bonus: reduced initial volatility, slight trust boost
   - **Detected**: Enemy initiates after detection
     - Standard combat start
   - **Caught**: Enemy initiates while party fleeing
     - Penalty: volatility spike, ABS meters start empty, hesitation
5. Create integrated test scene:
   - Stealth section with patrols
   - Option to ambush or avoid
   - Combat encounter if detected
   - Victory/defeat conditions

**Definition of Done**:
- Stealth seamlessly transitions to combat
- Combat initiation states apply correct modifiers
- Enemies engage party with combat AI
- Damage flows both directions
- Volatility reacts to combat events and detection
- Combat ends on victory or defeat
- Can replay with different approaches (stealth vs combat)

---

### Phase 7: UI & Feedback Polish
**Goal**: Visual communication of hidden systems

**Tasks**:
1. Implement HUD:
   - Health bars for all party members
   - ABS meters for Aya and Eli (no numbers)
   - Detection indicator (subtle fill bar)
   - Enemy alert icons (? and ! above heads)
   - Subtle volatility indicators
2. Create VolatilityEffects:
   - Screen shake intensity based on volatility
   - Vignette darkening
   - Color grading shift
3. Add audio cues:
   - State transition sounds
   - Command execution feedback
   - Hit/damage sounds
   - Detection warnings (heartbeat when near threshold)
   - Enemy callouts and footsteps
4. Refine animations:
   - Hesitation animations for low trust
   - Berserker attack speed increase
   - Paralysis slowdown
   - Sneak movement animations

**Definition of Done**:
- Player can read game state without numbers
- Volatility feels oppressive when high
- Trust differences are visible in behavior
- Detection feels tense and readable
- Audio reinforces mechanical feedback

---

### Phase 8: Testing & Tuning
**Goal**: Validate design intent and balance

**Tasks**:
1. Create system test scenes:
   - Volatility manipulation testing
   - Trust level testing
   - State transition testing
   - Detection threshold testing
   - Core progression impact testing
2. Balance tuning:
   - ABS fill rates
   - Volatility gain/loss rates
   - Trust impact coefficients
   - Berserker/Paralysis thresholds
   - Detection accumulation rates
   - Noise generation multipliers
   - Cover effectiveness
3. Edge case handling:
   - All party members in Paralysis
   - Zero trust scenarios
   - Maximum volatility behavior
   - Full detection while in combat
   - Low Core vs High Core combat viability
4. Progression arc validation:
   - Early game (Core 0-3): Stealth feels necessary
   - Mid game (Core 4-7): Mixed approach viable
   - Late game (Core 8-10): Direct combat earned
5. Document findings and adjustment rationale

**Definition of Done**:
- Core loop feels meaningful
- Stealth-to-combat progression arc is palpable
- State transitions occur at intended times
- Trust progression is noticeable
- Detection feels fair but tense
- Core progression changes feel substantive
- Systems feel integrated, not isolated

---

## Technical Constraints & Decisions

### 2D vs 3D:
**Decision**: Start with 3D (CharacterBody3D)
**Rationale**:
- More flexibility for camera work (tightening in Paralysis state)
- Easier to demonstrate spatial party positioning
- Can always reduce to 2.5D or pure 2D later
- Design document implies 3D spatial combat

### Input Buffering:
**Decision**: Custom 2-4 frame buffer
**Rationale**:
- Critical for action feel
- Must integrate with Paralysis state (delayed execution)
- Existing libraries can be referenced but custom implementation gives control

### Signal Architecture:
**Decision**: EventBus singleton + direct signals
**Rationale**:
- EventBus for global events (volatility, core, trust)
- Direct signals for local parent-child communication
- "Call down, signal up" pattern

### Camera:
**Decision**: Follow camera with state-based modulation
**Rationale**:
- Normal: Standard follow distance
- Berserker: Pulled back slightly (convey unsafe expansion)
- Paralysis: Tightens in (convey constriction)

### Animation:
**Decision**: AnimationTree with StateMachine root
**Rationale**:
- Production standard for complex animation
- State-based transitions natural fit
- Blend trees can layer emotional states

---

## Success Criteria for Prototype

The prototype is successful if:

1. **Mechanical Expression of Trauma**: Volatility is felt as friction, not subtraction
2. **Trust Matters**: High vs low trust Aya/Eli behave noticeably different
3. **State Transitions**: Berserker and Paralysis feel distinct and triggered appropriately
4. **Party Synchronization**: High Core feels like reduced friction, not power increase
5. **Stealth-to-Combat Arc**: Early game stealth feels necessary; late game combat feels earned
6. **Detection Tension**: Stealth creates meaningful tension and risk, not tedium
7. **No Placeholders**: All systems are production-ready, not "to be implemented"
8. **Design Fidelity**: Matches design document intent and formulas
9. **Playable Loop**: Can engage enemies via stealth or combat, use all characters, experience state changes and progression

---

## Risk Assessment

### High Risk:
- **ABS formula complexity**: Multiple factors could create balancing nightmare
  - Mitigation: Tunable constants in resources, extensive testing scene
- **State machine complexity**: Luto's states + party states + enemy detection states = interaction explosion
  - Mitigation: Clear state machine documentation, unit tests for transitions
- **Input buffering + Paralysis**: Delayed input execution is hard to feel good
  - Mitigation: Visual feedback (input stored indicator), audio cues
- **Stealth pacing**: Risk of tedious trial-and-error or trivial bypass
  - Mitigation: Generous detection thresholds, clear feedback, multiple viable paths

### Medium Risk:
- **Trust system opacity**: Hidden value affecting hidden timing
  - Mitigation: Debug UI mode showing internal values
- **Animation timing**: State-based animation needs to feel responsive
  - Mitigation: Animation tree prototyping before integration
- **Detection LOS calculations**: Performance and edge cases
  - Mitigation: Optimized raycasts, spatial partitioning, clear collision layers
- **Volatility affecting stealth**: Feedback loop could spiral (high volatility → detected → higher volatility)
  - Mitigation: Volatility caps, recovery windows, Core gates

### Low Risk:
- **3D asset creation**: Placeholder meshes acceptable for prototype
- **Enemy AI**: Simple state machine sufficient for patrol and chase
- **UI polish**: Functional > beautiful for prototype

---

## Next Steps (Post-Plan Approval)

1. Set up project structure (folders, AutoLoad configuration)
2. Begin Phase 1 implementation
3. Commit and push after each phase completion
4. Iterate based on playtesting feedback
5. Document discoveries and deviations from plan

---

**This plan represents production-ready systems, not prototypes. Every component is designed to ship.**
