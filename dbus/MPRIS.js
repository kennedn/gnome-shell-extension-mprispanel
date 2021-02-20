var Introspection = `<node>  
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Pause"/>
    <method name="PlayPause"/>
    <method name="Stop"/>
    <method name="Play"/>
    <method name="Seek">
      <arg type="x" name="Offset" direction="in"/>
    </method>
    <method name="SetPosition">
      <arg type="o" name="TrackId" direction="in"/>
      <arg type="x" name="Position" direction="in"/>
    </method>
    <method name="OpenUri">
      <arg type="s" name="Uri" direction="in"/>
    </method>
    <signal name="Seeked">
      <arg type="x" name="Position"/>
    </signal>
    <property type="s" name="PlaybackStatus" access="read"/>
    <property type="s" name="LoopStatus" access="readwrite"/>
    <property type="d" name="Rate" access="readwrite"/>
    <property type="b" name="Shuffle" access="readwrite"/>
    <property type="a{sv}" name="Metadata" access="read"/>
    <property type="d" name="Volume" access="readwrite"/>
    <property type="x" name="Position" access="read"/>
    <property type="d" name="MinimumRate" access="read"/>
    <property type="d" name="MaximumRate" access="read"/>
    <property type="b" name="CanGoNext" access="read"/>
    <property type="b" name="CanGoPrevious" access="read"/>
    <property type="b" name="CanPlay" access="read"/>
    <property type="b" name="CanPause" access="read"/>
    <property type="b" name="CanSeek" access="read"/>
    <property type="b" name="CanControl" access="read"/>
  </interface>
</node>`;