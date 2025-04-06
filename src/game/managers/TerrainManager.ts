// src/game/managers/TerrainManager.ts
import Phaser from "phaser";
import { TILE_SIZE } from "../constants"; // Keep TILE_SIZE for row height
import { Boulder } from "../entities/Boulder";
import { Enemy } from "../entities/Enemy";
import { Spike } from "../entities/Spike"; // Add Spike import
// import { BlockConfig } from "../types/BlockConfig"; // Not needed
import { EventBus } from "../EventBus";
import { Coin } from "../entities/Coin";
import Game from "../scenes/Game"; // Import Game scene type
import { ParticleManager } from "./ParticleManager";
// --- Remove BlockType and blockConfigs ---

export class TerrainManager {
    private scene: Game; // Use specific Game type
    // --- Remove map and groundLayer ---
    // private map: Phaser.Tilemaps.Tilemap;
    // private groundLayer: Phaser.Tilemaps.TilemapLayer;

    private generatedRowsMaxY: number = 0;
    private bouldersGroup: Phaser.Physics.Arcade.Group;
    private enemiesGroup: Phaser.Physics.Arcade.Group;
    // Change spikesGroup type to StaticGroup
    private spikesGroup?: Phaser.Physics.Arcade.StaticGroup;
    private coinsGroup?: Phaser.Physics.Arcade.Group;
    private particleManager?: ParticleManager; // Assuming ParticleManager exists

    // --- NEW: Row Management ---
    private rowColliderGroup: Phaser.Physics.Arcade.StaticGroup;
    private rowVisualsGroup: Phaser.GameObjects.Group;
    private rowColliders: Map<number, Phaser.GameObjects.GameObject> =
        new Map();
    private rowVisuals: Map<number, Phaser.GameObjects.GameObject> = new Map();
    // --------------------------

    // Map dimensions (adjust as needed)
    private mapWidthTiles = 25; // Width in terms of tiles/columns
    private mapHeightTiles = 500; // Max height in terms of tiles/rows
    private mapWidthPixels = this.mapWidthTiles * TILE_SIZE;
    private mapHeightPixels = this.mapHeightTiles * TILE_SIZE;

    // --- Generation Parameters (Tunable) ---
    private boulderSpawnChanceBase = 0.03;
    private enemySpawnChanceBase = 0.008;
    private spikeSpawnChanceBase = 0.03; // Add spike spawn chance
    private coinSpawnChanceBase = 0.005;
    private difficultyScaleFactor = 0.003;
    // ---------------------------------------

    // --- Initial Platform ---
    private initialPlatformRows = 5; // How many rows down the starting platform is
    private initialClearRows = 3; // How many empty rows above the platform
    // ------------------------

    private baseEnemySpeed = 30; // Define a base speed
    private enemySpeedDepthScale = 0.5; // How much speed increases per row depth

    constructor(
        scene: Game, // Use specific Game type
        bouldersGroup: Phaser.Physics.Arcade.Group,
        enemiesGroup: Phaser.Physics.Arcade.Group,
        coinsGroup?: Phaser.Physics.Arcade.Group,
        particleManager?: any
    ) {
        this.scene = scene;
        this.bouldersGroup = bouldersGroup;
        this.enemiesGroup = enemiesGroup;
        this.coinsGroup = coinsGroup;
        this.particleManager = particleManager;

        // Initialize spikesGroup as a StaticGroup
        this.spikesGroup = this.scene.physics.add.staticGroup({
            classType: Spike,
            // No need for physics properties here for static group
        });

        // --- Initialize new groups ---
        this.rowColliderGroup = this.scene.physics.add.staticGroup();
        this.rowVisualsGroup = this.scene.add.group();

        // Set the depth of the rowVisualsGroup to be behind entities
        this.rowVisualsGroup.setDepth(0);
        // -----------------------------

        // --- Remove tilemap and layer creation ---

        // Set initial generation point (below clear rows)
        this.generatedRowsMaxY = this.initialClearRows * TILE_SIZE;

        console.log("TerrainManager initialized for row-based system.");

        // Remove collision between spikes and row colliders (spikes are static)
    }

    // --- NEW: Return the collider group ---
    public getRowColliderGroup(): Phaser.Physics.Arcade.StaticGroup {
        return this.rowColliderGroup;
    }

    // Return spikes group (updated type)
    public getSpikesGroup(): Phaser.Physics.Arcade.StaticGroup | undefined {
        return this.spikesGroup;
    }

    // --- NEW: Public getters for dimensions ---
    public getMapWidthPixels(): number {
        return this.mapWidthPixels;
    }

    public getMapHeightPixels(): number {
        return this.mapHeightPixels;
    }
    // --- END NEW ---

    public getInitialSpawnPoint(): { x: number; y: number } {
        // Spawn player slightly above the first platform row
        const spawnYPx =
            (this.initialPlatformRows - 1) * TILE_SIZE + TILE_SIZE / 2;
        return {
            x: this.mapWidthPixels / 2,
            y: spawnYPx,
        };
    }

    public generateInitialChunk(): void {
        // Generate the initial solid dirt platform first
        console.log(
            `Generating initial platform at row Y=${this.initialPlatformRows}`
        );
        const platformWorldY = this.initialPlatformRows * TILE_SIZE;
        this.generateRow(platformWorldY, true); // Force generate platform row

        // Generate some rows below the platform to start
        const initialWorldDepthRows = 20;
        const startY = (this.initialPlatformRows + 1) * TILE_SIZE;
        const endY = startY + initialWorldDepthRows * TILE_SIZE;

        console.log(`Generating initial chunk from Y=${startY} to Y=${endY}`);
        for (let y = startY; y < endY; y += TILE_SIZE) {
            this.generateRow(y);
        }
        this.generatedRowsMaxY = endY;
        // --- REMOVED updateCollision call --- Collision is handled per-sprite
    }

    public update(cameraBottomY: number): void {
        const generationThreshold = cameraBottomY + TILE_SIZE * 10; // Generate further ahead

        if (generationThreshold > this.generatedRowsMaxY) {
            const startY = this.generatedRowsMaxY;
            const endY = generationThreshold;
            for (let y = startY; y < endY; y += TILE_SIZE) {
                // Only generate rows below the initial platform naturally
                if (y >= (this.initialPlatformRows + 1) * TILE_SIZE) {
                    this.generateRow(y);
                }
            }
            this.generatedRowsMaxY = endY;
        }
    }

    public clearCurrentRow(triggerWorldY: number): boolean {
        // Calculate the row index *below* the trigger point
        const playerRowYBelow = Math.floor(triggerWorldY / TILE_SIZE) + 1;
        // Calculate the row *above* that row, which is the row the player is currently on
        const playerCurrentRow = playerRowYBelow - 1;

        // Get the world Y coordinate of the top of the row below
        const targetRowWorldY = playerRowYBelow * TILE_SIZE;
        const targetTileY = playerRowYBelow; // Row index to clear

        console.log(
            `Attempting to clear row BELOW player at tileY=${targetTileY} (WorldY ~${targetRowWorldY})`
        );
        console.log(
            `Also clearing spikes from row ABOVE at tileY=${playerCurrentRow}`
        );

        const collider = this.rowColliders.get(targetTileY);
        const visual = this.rowVisuals.get(targetTileY);

        if (collider) {
            console.log(`Clearing collider for row ${targetTileY}`);
            this.rowColliderGroup.remove(collider, true, true); // Remove from group, destroy GO, destroy body
            this.rowColliders.delete(targetTileY);

            if (visual) {
                console.log(`Clearing visual for row ${targetTileY}`);
                this.rowVisualsGroup.remove(visual, true); // Remove from group, destroy GO
                this.rowVisuals.delete(targetTileY);
            }

            // SUPER SIMPLE APPROACH: Just clear all spikes on row ABOVE the target row
            if (this.spikesGroup) {
                const rowAboveWorldY = playerCurrentRow * TILE_SIZE;

                this.spikesGroup.getChildren().forEach((spikeGO) => {
                    const spike = spikeGO as Spike;
                    if (!spike.active) return;

                    // Spikes are positioned at bottom center with super(scene, x + TILE_SIZE / 2, y + TILE_SIZE, "spikes")
                    // This means their Y value is approximately at the bottom of the tile
                    // For a spike on row P, its Y would be near (P+1)*TILE_SIZE

                    // Check if this spike should be removed
                    // Using a simple Y range check
                    if (
                        spike.y > rowAboveWorldY &&
                        spike.y < rowAboveWorldY + TILE_SIZE * 1.2
                    ) {
                        console.log(
                            `Destroying spike at Y=${spike.y}, on row above target`
                        );
                        spike.takeDamage(1);
                    }
                });
            }

            // Trigger particles across the cleared row
            if (this.particleManager) {
                // Particles for dirt row
                const particleY = targetRowWorldY + TILE_SIZE / 2;
                for (let i = 0; i < this.mapWidthTiles; i++) {
                    this.particleManager.triggerParticles(
                        "dirt_tile",
                        i * TILE_SIZE + TILE_SIZE / 2,
                        particleY,
                        { count: 3 }
                    );
                }

                // Particles for spike row (one row above)
                const spikeRowParticleY =
                    playerCurrentRow * TILE_SIZE + TILE_SIZE / 2;
                for (let i = 0; i < this.mapWidthTiles; i++) {
                    this.particleManager.triggerParticles(
                        "spikes",
                        i * TILE_SIZE + TILE_SIZE / 2,
                        spikeRowParticleY,
                        { count: 2, speed: 70, scale: 0.4 }
                    );
                }
            }

            // Emit an event that a row was cleared
            EventBus.emit("dirt-row-cleared", { tileY: targetTileY });
            return true; // Row cleared
        } else {
            console.log(
                `No collider found for row ${targetTileY}, cannot clear.`
            );
            return false; // No row to clear
        }
    }
    /**
     * Generates a single row's collider and visuals.
     * @param worldY The world Y coordinate of the top of the row to generate.
     * @param forceGenerate Skip checks, used for initial platform.
     */
    private generateRow(worldY: number, forceGenerate = false): void {
        const tileY = Math.floor(worldY / TILE_SIZE);
        if (
            tileY < 0 ||
            tileY >= this.mapHeightTiles ||
            this.rowColliders.has(tileY)
        ) {
            return; // Out of bounds or already generated
        }

        // Skip generation above initial platform unless forced
        if (!forceGenerate && tileY <= this.initialPlatformRows) {
            return;
        }

        const colliderYOffset = TILE_SIZE * 0.9; // Position collider near the bottom of the tile space
        const colliderHeight = TILE_SIZE * 0.1; // Thin collider strip

        const collider = this.scene.physics.add.staticImage(
            0, // Center X
            worldY + colliderYOffset, // Positioned towards the bottom
            "" // No texture needed
        );
        collider.setVisible(false); // Keep it invisible
        collider.body.setSize(this.mapWidthPixels + 30, colliderHeight); // Set precise physics size
        collider.body.setOffset(0, 0); // Adjust offset if needed based on origin
        collider.setData("isRowCollider", true); // Add data marker if needed later
        collider.setData("rowY", tileY); // Store row index on collider too

        this.rowColliderGroup.add(collider);
        this.rowColliders.set(tileY, collider);
        // --- End Collider ---

        // 2. Create Row Visual (TileSprite)
        const visual = this.scene.add.tileSprite(
            this.mapWidthPixels / 2, // Center X
            worldY + TILE_SIZE / 2, // Center Y
            this.mapWidthPixels, // Full width
            TILE_SIZE, // Full height
            "dirt_tile" // Use the dirt texture
        );
        // Set a low depth value for the visual row to ensure it's drawn behind entities
        visual.setDepth(0);
        this.rowVisualsGroup.add(visual);
        this.rowVisuals.set(tileY, visual);

        // 3. Spawn Entities *ON* the newly generated row's surface
        // Use the collider's Y position as the surface reference
        const spawnSurfaceY = worldY + colliderYOffset - colliderHeight / 2; // Surface is top of collider
        // Adjust spike spawn Y to place its origin at the top-center of the tile space
        const spikeSpawnY = worldY;

        if (tileY <= this.initialPlatformRows) return; // Don't spawn on initial platform rows

        const depthInRows = tileY - (this.initialPlatformRows + 1); // Rows below platform
        const depthFactor =
            Math.max(0, depthInRows) * this.difficultyScaleFactor;

        const currentBoulderChance = this.boulderSpawnChanceBase + depthFactor;
        const currentEnemyChance = this.enemySpawnChanceBase + depthFactor;
        const currentSpikeChance = this.spikeSpawnChanceBase + depthFactor;
        const currentCoinChance = this.coinSpawnChanceBase + depthFactor;

        const currentEnemySpeed = Math.min(
            100, // Max speed cap
            this.baseEnemySpeed + depthInRows * this.enemySpeedDepthScale
        );

        for (let tileX = 0; tileX < this.mapWidthTiles; tileX++) {
            const spawnWorldX = tileX * TILE_SIZE + TILE_SIZE / 2;

            // Check if space is occupied (crude check, could improve)
            // This is a basic check, might need refinement if entities overlap badly
            let spaceOccupied = false;
            // Need to check spikes group too now for occupancy
            const checkRadius = TILE_SIZE * 0.8; // Check slightly smaller than tile
            const groupsToCheck = [
                this.bouldersGroup,
                this.enemiesGroup,
                this.spikesGroup,
                this.coinsGroup,
            ];

            for (const group of groupsToCheck) {
                if (!group) continue;
                group.getChildren().forEach((go) => {
                    const body = go.body as
                        | Phaser.Physics.Arcade.Body
                        | Phaser.Physics.Arcade.StaticBody;
                    if (
                        body &&
                        Math.abs(
                            body.position.x + body.offset.x - spawnWorldX
                        ) < checkRadius &&
                        Math.abs(
                            body.position.y + body.offset.y - spawnSurfaceY
                        ) < checkRadius
                    ) {
                        spaceOccupied = true;
                    }
                });
                if (spaceOccupied) break;
            }

            if (spaceOccupied) continue; // Skip spawning if something is already there

            if (Math.random() < currentBoulderChance) {
                const boulder = new Boulder(
                    this.scene,
                    spawnWorldX,
                    spawnSurfaceY - TILE_SIZE / 2 // Spawn slightly above surface
                );
                // Set depth higher than tiles to draw on top
                boulder.setDepth(10);
                this.bouldersGroup.add(boulder);
                spaceOccupied = true; // Mark space as occupied
            } else if (Math.random() < currentEnemyChance) {
                const enemy = new Enemy(
                    this.scene,
                    spawnWorldX,
                    spawnSurfaceY - TILE_SIZE / 2 // Spawn slightly above surface
                );
                // Set depth higher than tiles to draw on top
                enemy.setDepth(10);
                enemy.setSpeed(currentEnemySpeed);
                this.enemiesGroup.add(enemy);
                spaceOccupied = true; // Mark space as occupied
            } else if (Math.random() < currentSpikeChance) {
                if (this.spikesGroup) {
                    // Spawn Y is now the top of the row's tile space,
                    // as the Spike's origin is at its base.
                    const spike = new Spike(
                        this.scene,
                        spawnWorldX - TILE_SIZE / 2, // Adjust X back because origin is center now
                        spikeSpawnY + 10 // Y is the top of the row
                    );
                    // Set depth higher than tiles to draw on top
                    spike.setDepth(10);
                    // Add to the static group
                    this.spikesGroup.add(spike);
                    spaceOccupied = true; // Mark space as occupied
                }
            }

            if (!spaceOccupied && Math.random() < currentCoinChance) {
                const coin = Coin.spawn(
                    this.scene,
                    this.coinsGroup as Phaser.Physics.Arcade.Group,
                    spawnWorldX,
                    spawnSurfaceY - TILE_SIZE / 2 // Spawn slightly above surface
                );
                // Coins.spawn returns void, not the coin instance, so we'll set depth for the entire group
                if (this.coinsGroup) {
                    // Set depth for all coins in the group
                    this.coinsGroup.setDepth(10);
                }
            }
        }
    }
    // --- END REVISED ---

    // --- REMOVED updateCollision ---

    // --- REVISED handleCreateExplosion --- Works on rows now
    public handleCreateExplosion(data: {
        worldX: number;
        worldY: number;
        radius: number;
    }) {
        console.log(
            "Handling explosion at:",
            data.worldX,
            data.worldY,
            "Radius:",
            data.radius
        );
        const radiusSq = data.radius * data.radius;
        const centerTileX = Math.floor(data.worldX / TILE_SIZE);
        const centerTileY = Math.floor(data.worldY / TILE_SIZE);
        const tileRadius = Math.ceil(data.radius / TILE_SIZE);

        // Clear rows within the blast radius
        for (let dy = -tileRadius; dy <= tileRadius; dy++) {
            const targetTileY = centerTileY + dy;
            const rowWorldY = targetTileY * TILE_SIZE;

            // Check vertical distance roughly
            const yDist = data.worldY - (rowWorldY + TILE_SIZE / 2);
            if (yDist * yDist > radiusSq) continue; // Skip row if too far vertically

            // Attempt to clear the entire row if any part is within radius (simplification)
            // A more precise check could iterate columns, but clearing full row is simpler
            // Check horizontal distance of row center to explosion center
            const xDist = data.worldX - this.mapWidthPixels / 2;
            const checkRadiusSq =
                radiusSq +
                (this.mapWidthPixels / 2) * (this.mapWidthPixels / 2); // Allow hitting edge
            if (xDist * xDist + yDist * yDist <= checkRadiusSq) {
                this.clearCurrentRow(rowWorldY - TILE_SIZE / 2); // Pass Y above the target row
            }
        }

        // Damage/Destroy Entities in blast radius (remains similar)
        const explosionWorldX = data.worldX;
        const explosionWorldY = data.worldY;

        // Damage Enemies
        this.enemiesGroup?.getChildren().forEach((enemyGO) => {
            const enemy = enemyGO as Enemy;
            if (!enemy.active) return;
            const distSq = Phaser.Math.Distance.Squared(
                explosionWorldX,
                explosionWorldY,
                enemy.x,
                enemy.y
            );
            if (distSq <= radiusSq) {
                enemy.takeDamage(999); // Instant kill in blast
            }
        });

        // Damage Spikes - Use direct distance check
        this.spikesGroup?.getChildren().forEach((spikeGO) => {
            const spike = spikeGO as Spike;
            if (!spike.active) return;

            const distSq = Phaser.Math.Distance.Squared(
                explosionWorldX,
                explosionWorldY,
                spike.x, // Spike's position
                spike.y
            );

            if (distSq <= radiusSq) {
                spike.takeDamage(1); // Kill spike in explosion
            }
        });

        // Damage Boulders
        this.bouldersGroup?.getChildren().forEach((boulderGO) => {
            const boulder = boulderGO as Boulder;
            if (!boulder.active) return;
            const distSq = Phaser.Math.Distance.Squared(
                explosionWorldX,
                explosionWorldY,
                boulder.x,
                boulder.y
            );
            if (distSq <= radiusSq) {
                // Apply enough damage to destroy boulder in explosion
                boulder.takeDamage(3);
            }
        });
    }
    // --- END REVISED ---

    // Optional: Add cleanup method
    public destroy() {
        this.rowColliders.clear();
        this.rowVisuals.clear();
        this.rowColliderGroup.destroy(true); // Destroy children
        this.rowVisualsGroup.destroy(true); // Destroy children
        // Destroy spike group too
        this.spikesGroup?.destroy(true);
        console.log("TerrainManager destroyed.");
    }

    /**
     * Gets the Y coordinate where an entity should be positioned to stand on a row.
     * This helps entities "snap" to the surface of a row when walking on it.
     *
     * @param rowY The row index (not world coordinate)
     * @param entityHeight The height of the entity in pixels
     * @returns The world Y coordinate where the entity's bottom should be positioned
     */
    public getRowSurfaceY(rowY: number, entityHeight: number): number {
        // Row world Y is the top of the row
        const rowTopY = rowY * TILE_SIZE;

        // Return the position for the entity's bottom to be exactly at the row's top
        return rowTopY - entityHeight / 2;
    }
}

