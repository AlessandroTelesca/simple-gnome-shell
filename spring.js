/** A damped spring set by its response (seconds) and damping fraction, as SwiftUI gives them. */
export class Spring {
    constructor(response, dampingFraction) {
        this.value = 0;
        this.velocity = 0;
        this.target = 0;
        this.setParams(response, dampingFraction);
    }

    setParams(response, dampingFraction) {
        this._response = response;
        this._damping = dampingFraction;
    }

    /** Steps by `ms`. True once it has settled on its target. */
    update(ms) {
        const dt = Math.min(ms / 1000, 0.1);
        if (!(dt > 0))
            return false;
        const x0 = this.value - this.target, v0 = this.velocity;
        if (Math.abs(x0) < 0.001 && Math.abs(v0) < 0.001) {
            this.value = this.target;
            this.velocity = 0;
            return true;
        }
        const omega = 2 * Math.PI / this._response;
        const zeta = this._damping;
        let x, v;
        if (zeta < 0.999) {
            const omegaD = omega * Math.sqrt(1 - zeta * zeta);
            const alpha = zeta * omega;
            const exp = Math.exp(-alpha * dt), cos = Math.cos(omegaD * dt), sin = Math.sin(omegaD * dt);
            x = exp * (x0 * cos + (v0 + alpha * x0) / omegaD * sin);
            v = exp * (v0 * cos - (alpha * v0 + omega * omega * x0) / omegaD * sin);
        } else {
            const exp = Math.exp(-omega * dt);
            x = exp * (x0 + (v0 + omega * x0) * dt);
            v = exp * (v0 - omega * (v0 + omega * x0) * dt);
        }
        this.value = x + this.target;
        this.velocity = v;
        return false;
    }

    jump(value) {
        this.value = this.target = value;
        this.velocity = 0;
    }
}
