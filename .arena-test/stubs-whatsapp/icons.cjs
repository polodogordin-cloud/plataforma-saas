import React from "react";
const Icon = (props) => React.createElement("svg", { ...props, "data-icon": props["data-icon"] ?? "icon" });
module.exports = {
  MessageCircle: Icon, Check: Icon, Copy: Icon, Loader2: Icon,
  ExternalLink: Icon, ChevronRight: Icon,
  AlertCircle: Icon, CheckCircle2: Icon, Eye: Icon, EyeOff: Icon,
};
