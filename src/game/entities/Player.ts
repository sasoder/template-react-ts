// src/game/entities/Player.ts
import Phaser from "phaser";
import { TILE_SIZE } from "../constants";
import { EventBus } from "../EventBus"; // Import EventBus
import { Boulder } from "./Boulder"; // Import Boulder type
import { Enemy } from "./Enemy"; // Import Enemy type
import Game from "../scenes/Game";
// --- Import new entity types ---

export class Player extends Phaser.Physics.Arcade.Sprite {
    private moveSpeed = 80; // Adjust as needed
    private jumpVelocity = -200; // Adjust as needed
    private bounceVelocity = -100; // Bounce after stomp
    private digCooldown = 150; // Milliseconds between digs
    private lastDigTime = 0;
    public isInvulnerable = false;
    private invulnerabilityDuration = 500; // ms
    private invulnerabilityTimer?: Phaser.Time.TimerEvent;
    private recentBoulderCollisions: Map<Boulder, number> = new Map(); // Track recent boulder collisions
    private boulderCollisionCooldown = 500; // ms between allowed boulder collisions

    // Scene reference with correct type
    private gameScene: Game;

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, "player"); // Assuming 'player' spritesheet is loaded
        this.gameScene = scene as Game; // Cast scene to Game type
        scene.add.existing(this);
        scene.physics.add.existing(this);

        this.setCollideWorldBounds(true); // Keep player within horizontal bounds
        this.setGravityY(300); // Adjust gravity
        this.body?.setSize(TILE_SIZE * 0.8, TILE_SIZE * 0.9); // Adjust collider size/offset
        this.body?.setOffset(TILE_SIZE * 0.1, TILE_SIZE * 0.05);
    }

    private canJumpOrDig(): boolean {
        return (
            ((this.body?.blocked.down || this.body?.touching.down) &&
                this.scene.time.now > this.lastDigTime + this.digCooldown) ||
            false
        );
    }

    private attemptJumpAndDig() {
        if (!this.canJumpOrDig()) {
            return;
        }

        this.lastDigTime = this.scene.time.now;

        // 1. Trigger Jump
        this.setVelocityY(this.jumpVelocity);
        // Play jump animation if available
        // this.anims.play('jump', true);

        // 2. Directly attempt row clear via TerrainManager
        const checkWorldX = this.x;
        // Check slightly below the player's bottom center
        const checkWorldY = this.body!.bottom + 1; // Check just below feet

        // Access terrainManager through the typed scene reference
        const rowCleared =
            this.gameScene.terrainManager.clearCurrentRow(checkWorldY);

        if (rowCleared) {
            console.log(`Player initiated row clear at Y ~ ${checkWorldY}`);
            // Add sound effect? Visual effect?
            // this.gameScene.sound.play('dig_sound');
        } else {
            // console.log(`Jumped, but no dirt to clear below at Y ~ ${checkWorldY}`);
        }
    }

    bounce() {
        this.setVelocityY(this.bounceVelocity);
    }

    takeDamage(amount: number = 1): boolean {
        if (this.isInvulnerable) {
            return true; // Still alive, but took no damage
        }

        const currentLives = this.scene.registry.get("lives") as number;
        const newLives = Math.max(0, currentLives - amount);
        this.scene.registry.set("lives", newLives);

        EventBus.emit("update-stats", { lives: newLives }); // Quick update
        EventBus.emit("player-damaged"); // For effects like flashing/sound
        // Play hit sound
        this.scene.sound.play("hit");
        console.log(`Player took damage! Lives remaining: ${newLives}`);

        if (newLives <= 0) {
            EventBus.emit("player-died");
            // Optionally play death animation, disable input etc.
            this.setActive(false); // Stop updates
            this.setVisible(false); // Hide
            this.body!.enable = false; // Disable physics
            return false; // Player is dead
        } else {
            // Become invulnerable briefly
            this.setTemporaryInvulnerability(this.invulnerabilityDuration);
            return true; // Player survived
        }
    }

    setTemporaryInvulnerability(duration: number) {
        if (this.isInvulnerable) {
            // If already invulnerable, potentially reset the timer
            // Or just return, depending on desired behavior
            return;
        }
        this.isInvulnerable = true;
        this.setAlpha(0.5); // Visual feedback

        // Clear existing timer if any
        if (this.invulnerabilityTimer) {
            this.invulnerabilityTimer.remove();
        }

        // Set a timer to remove invulnerability
        this.invulnerabilityTimer = this.scene.time.delayedCall(
            duration,
            () => {
                this.isInvulnerable = false;
                this.setAlpha(1);
                this.invulnerabilityTimer = undefined; // Clear the timer reference
            }
        );
    }

    handleBoulderCollision(obstacle: Boulder) {
        if (!this.body || !obstacle.active || this.isInvulnerable) {
            return;
        }

        // Check for recent collision with this boulder to prevent damage spam
        const currentTime = this.scene.time.now;
        const lastCollisionTime =
            this.recentBoulderCollisions.get(obstacle) || 0;

        if (currentTime - lastCollisionTime < this.boulderCollisionCooldown) {
            // Recent collision with this boulder, don't process again
            return;
        }

        // Record this collision
        this.recentBoulderCollisions.set(obstacle, currentTime);

        const playerBody = this.body as Phaser.Physics.Arcade.Body;
        const obstacleVelocity = obstacle.getVelocity();

        const isLandingOnTop =
            playerBody.velocity.y > 0 &&
            playerBody.bottom <= obstacle.y - obstacle.height / 2 + 5;

        if (isLandingOnTop) {
            // Allow the player to stand on top of boulders
            this.setVelocityY(0);
            return;
        }

        // Determine if player is pushing the boulder
        const isPushingBoulder =
            // Player must be moving toward the boulder
            ((playerBody.velocity.x > 10 && this.x < obstacle.x) ||
                (playerBody.velocity.x < -10 && this.x > obstacle.x)) &&
            // And boulder should be slow or moving in same direction
            (obstacle.getVelocityMagnitude() < 30 ||
                (obstacle.getVelocity().x > 0 && playerBody.velocity.x > 0) ||
                (obstacle.getVelocity().x < 0 && playerBody.velocity.x < 0));

        if (isPushingBoulder) {
            // Player is pushing - mark boulder as safe and apply physics naturally
            obstacle.markAsSafeForPlayer();
            return;
        }

        // Check if boulder is dangerous specifically for the player
        if (obstacle.isDangerous(true)) {
            // Boulder is moving fast enough to be dangerous to player
            console.log(
                `Player hit by dangerous boulder! Velocity: ${obstacle
                    .getVelocityMagnitude()
                    .toFixed(1)}`
            );
            this.takeDamage();

            // Apply knockback in opposite direction of boulder's movement
            const knockbackX = this.x < obstacle.x ? -120 : 120;
            const knockbackY = -100;
            this.setVelocity(knockbackX, knockbackY);
            return;
        }

        // For non-dangerous boulders, check relative velocity for minor interactions
        const velocityDiffX = Math.abs(
            playerBody.velocity.x - obstacleVelocity.x
        );

        // Slight pushback from stationary or slow-moving boulders
        const pushDirection = this.x < obstacle.x ? -1 : 1;
        const pushForce = Math.max(15, velocityDiffX * 0.4);
        this.setVelocityX(pushDirection * pushForce);

        // Mark the boulder as safe for player (but still dangerous to enemies)
        obstacle.markAsSafeForPlayer();
    }

    handleEnemyCollision(enemy: Enemy): boolean {
        if (!this.body || !enemy.body || !enemy.active) {
            return false;
        }

        const playerBody = this.body as Phaser.Physics.Arcade.Body;
        const enemyBody = enemy.body as Phaser.Physics.Arcade.Body;

        const isStomping =
            playerBody.velocity.y > 0 && playerBody.bottom <= enemyBody.top + 8; // Increased tolerance

        if (isStomping) {
            console.log("Enemy stomped!");
            enemy.takeDamage(999);
            this.bounce();

            // Award coins
            const coinReward = 5;
            const currentCoins = this.scene.registry.get("coins") as number;
            this.scene.registry.set("coins", currentCoins + coinReward);

            // Update total coins collected
            let totalCoinsCollected =
                (this.scene.registry.get("totalCoinsCollected") as number) || 0;
            totalCoinsCollected += coinReward;
            this.scene.registry.set("totalCoinsCollected", totalCoinsCollected);

            EventBus.emit("stats-changed");
            return true;
        } else if (!this.isInvulnerable) {
            console.log("Player ran into enemy!");
            const survived = this.takeDamage();
            enemy.takeDamage(999);

            if (survived) {
                const knockbackX = this.x < enemy.x ? -150 : 150;
                const knockbackY = -100;
                this.setVelocity(knockbackX, knockbackY);
            }
            return true;
        }

        return false;
    }

    // Basic movement update
    update(
        cursors: Phaser.Types.Input.Keyboard.CursorKeys,
        time: number,
        delta: number
    ) {
        // Skip update if player is inactive (e.g., after dying)
        if (!this.active) {
            this.setVelocity(0);
            return;
        }

        // Clean up old collision records to prevent memory leaks
        this.cleanupCollisionRecords(time);

        if (cursors.left.isDown) {
            this.setVelocityX(-this.moveSpeed);
            this.setFlipX(true); // Flip sprite left
            // this.anims.play('run', true);
        } else if (cursors.right.isDown) {
            this.setVelocityX(this.moveSpeed);
            this.setFlipX(false); // Normal sprite direction
            // this.anims.play('run', true);
        } else {
            this.setVelocityX(0);
            // Play idle animation if on ground
            if (this.body?.blocked.down || this.body?.touching.down) {
                // this.anims.play('idle', true);
            }
        }

        // --- Jump / Dig ---
        if (cursors.up.isDown) {
            this.attemptJumpAndDig();
        }

        // Prevent sticking to walls when falling
        if (
            !this.body?.blocked.down &&
            !this.body?.touching.down &&
            this.body?.velocity.x !== 0
        ) {
            if (this.body?.blocked.left || this.body?.blocked.right) {
                this.setVelocityX(0);
            }
        }
    }

    /**
     * Clean up old collision records to prevent memory leaks
     */
    private cleanupCollisionRecords(currentTime: number): void {
        for (const [
            boulder,
            timestamp,
        ] of this.recentBoulderCollisions.entries()) {
            if (currentTime - timestamp > this.boulderCollisionCooldown) {
                this.recentBoulderCollisions.delete(boulder);
            }
        }
    }

    // Ensure timer is cleaned up if the player is destroyed
    destroy(fromScene?: boolean) {
        if (this.invulnerabilityTimer) {
            this.invulnerabilityTimer.remove();
            this.invulnerabilityTimer = undefined;
        }
        // Clear collision records
        this.recentBoulderCollisions.clear();
        super.destroy(fromScene);
    }
}

