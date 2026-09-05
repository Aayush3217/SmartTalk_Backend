
exports.getHealth = (req, res) => {
    res.status(200).json({
        message: "Health is good"
    });
}

module.exports = exports;